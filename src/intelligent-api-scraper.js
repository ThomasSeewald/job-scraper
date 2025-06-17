const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class IntelligentJobScraper {
    constructor(jobType = 'job', publishedSince = 28) {
        this.jobType = jobType; // 'job' or 'ausbildung'
        this.angebotsart = jobType === 'ausbildung' ? 4 : 1; // 1=Jobs, 4=Ausbildung
        this.publishedSince = publishedSince; // 28 initial, 7 daily
        
        this.sessionId = this.generateSessionId();
        this.apiConfig = config.arbeitsagentur;
        
        this.stats = {
            processedPostcodes: 0,
            totalApiCalls: 0,
            totalJobsFound: 0,
            newEmployers: 0,
            updatedEmployers: 0,
            newPositions: 0,
            skippedDuplicates: 0,
            errorCount: 0,
            startTime: new Date()
        };
        
        console.log(`🚀 Intelligent ${jobType.toUpperCase()} Scraper initialized`);
        console.log(`📅 Scanning jobs published in last ${publishedSince} days`);
        console.log(`🆔 Session: ${this.sessionId}`);
    }
    
    generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `${this.jobType}-scraper-${this.publishedSince}d-${timestamp}-${randomSuffix}`;
    }
    
    /**
     * Run intelligent scraping with normalized database integration
     */
    async runIntelligentScraping(postcodeLimit = 100) {
        console.log(`\n🚀 Starting intelligent ${this.jobType} scraping...`);
        console.log(`📊 Target: ${postcodeLimit} postal codes`);
        
        try {
            // Get postal codes (prioritize high-activity areas)
            const postalCodes = await this.getOptimizedPostalCodes(postcodeLimit);
            
            console.log(`📋 Processing ${postalCodes.length} optimized postal codes`);
            
            // Log which postal codes we're processing
            const plzList = postalCodes.map(p => `${p.postal_code}(${p.city})`).slice(0, 10);
            console.log(`🎯 Top PLZ: ${plzList.join(', ')}${postalCodes.length > 10 ? '...' : ''}`);
            
            for (const [index, postcodeData] of postalCodes.entries()) {
                console.log(`\n[${index + 1}/${postalCodes.length}] Scanning ${postcodeData.postal_code} (${postcodeData.city})`);
                
                // Query API with intelligence
                const apiResult = await this.queryJobsForPostcode(postcodeData.postal_code);
                
                if (apiResult.success && apiResult.jobs.length > 0) {
                    // Process with intelligent duplicate detection
                    await this.processJobsIntelligently(apiResult.jobs, postcodeData);
                }
                
                this.stats.processedPostcodes++;
                
                // Rate limiting
                if (index < postalCodes.length - 1) {
                    await this.delay(config.scraping.delayBetweenRequests);
                }
                
                // Progress report every 10 postal codes for better visibility
                if ((index + 1) % 10 === 0) {
                    this.printProgress();
                }
            }
            
            await this.printFinalStats();
            return this.stats;
            
        } catch (error) {
            console.error('❌ Intelligent scraping failed:', error.message);
            throw error;
        }
    }
    
    /**
     * Get optimized postal codes (prioritize areas with many job_scrp_employers)
     */
    async getOptimizedPostalCodes(limit) {
        const client = await pool.connect();
        
        try {
            // Prioritize postal codes where we already have job_scrp_employers (likely active job markets)
            const query = `
                SELECT 
                    pc.postal_code, 
                    pc.city,
                    pc.latitude,
                    pc.longitude,
                    COALESCE(emp_count.count, 0) as existing_employers,
                    COALESCE(pc.so_often_used, 0) as usage_score
                FROM our_sql_postal_code pc
                LEFT JOIN (
                    SELECT arbeitsort_plz, COUNT(DISTINCT arbeitgeber) as count 
                    FROM job_scrp_arbeitsagentur_jobs_v2 
                    WHERE arbeitsort_plz IS NOT NULL 
                    GROUP BY arbeitsort_plz
                ) emp_count ON pc.postal_code = emp_count.arbeitsort_plz
                WHERE pc.postal_code IS NOT NULL 
                AND LENGTH(pc.postal_code) = 5
                GROUP BY pc.postal_code, pc.city, pc.latitude, pc.longitude, emp_count.count, pc.so_often_used
                ORDER BY 
                    existing_employers DESC,
                    usage_score DESC,
                    RANDOM()
                LIMIT $1
            `;
            
            const result = await client.query(query, [limit]);
            return result.rows;
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Query API for specific postal code with job type
     */
    async queryJobsForPostcode(postalCode) {
        const startTime = Date.now();
        
        try {
            const params = {
                size: 100,
                page: 1,
                wo: postalCode,
                umkreis: 5, // 5km radius
                angebotsart: this.angebotsart,
                veroeffentlichtseit: this.publishedSince // Key parameter!
            };
            
            console.log(`🔍 API call: PLZ ${postalCode}, ${this.jobType}, ${this.publishedSince} days`);
            
            const response = await axios.get(this.apiConfig.baseURL, {
                headers: {
                    'X-API-Key': this.apiConfig.apiKey,
                    'User-Agent': this.apiConfig.userAgent,
                    'Accept': 'application/json'
                },
                params: params,
                timeout: config.scraping.timeout
            });
            
            const data = response.data;
            const jobCount = data.stellenangebote ? data.stellenangebote.length : 0;
            const duration = Date.now() - startTime;
            
            this.stats.totalApiCalls++;
            this.stats.totalJobsFound += jobCount;
            
            console.log(`✅ Found ${jobCount} ${this.jobType}s (${data.maxErgebnisse || 0} total) - ${duration}ms`);
            
            return {
                success: true,
                postalCode: postalCode,
                jobCount: jobCount,
                totalAvailable: data.maxErgebnisse || 0,
                jobs: data.stellenangebote || [],
                queryParams: params,
                rawResponse: data
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ API error for ${postalCode}:`, error.message);
            this.stats.errorCount++;
            
            return {
                success: false,
                postalCode: postalCode,
                error: error.message
            };
        }
    }
    
    /**
     * Process jobs with intelligent duplicate detection
     */
    async processJobsIntelligently(jobs, postcodeData) {
        const client = await pool.connect();
        
        try {
            // Process each job in its own transaction to prevent cascading failures
            for (const job of jobs) {
                try {
                    await client.query('BEGIN');
                    await this.processJobIntelligently(client, job, postcodeData);
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Error processing job ${job.refnr || 'unknown'}:`, error.message);
                    this.stats.errorCount++;
                }
            }
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Process single job with full intelligence
     */
    async processJobIntelligently(client, job, postcodeData) {
        try {
            // Validate essential job data
            if (!job.arbeitgeber || !job.titel || !job.beruf) {
                console.warn(`⚠️ Skip job ${job.refnr}: Missing essential data (arbeitgeber: ${!!job.arbeitgeber}, titel: ${!!job.titel}, beruf: ${!!job.beruf})`);
                return;
            }
            
            // 1. Find or create employer
            const employer = await this.findOrCreateEmployer(client, job);
            
            if (!employer) {
                console.warn(`⚠️ Could not process employer for job ${job.refnr}`);
                return;
            }
            
            // 2. Check if job position already exists
            const existingPosition = await this.checkExistingPosition(
                client, 
                employer.id, 
                job.titel, 
                job.beruf, 
                this.jobType
            );
            
            if (existingPosition) {
                // Position exists - increment times_seen
                await this.updateExistingPosition(client, existingPosition.id);
                this.stats.skippedDuplicates++;
                console.log(`⏭️ Skip: ${job.titel} bei ${job.arbeitgeber} (bereits bekannt)`);
            } else {
                // New position - create it
                await this.createNewPosition(client, employer.id, job);
                this.stats.newPositions++;
                console.log(`➕ Neu: ${job.titel} bei ${job.arbeitgeber}`);
            }
            
            // 3. Store complete API record for reference
            await this.storeApiRecord(client, job, employer.id);
            
        } catch (error) {
            console.error(`❌ Error processing job ${job.refnr}:`, error.message);
        }
    }
    
    /**
     * Find existing employer or create new one
     */
    async findOrCreateEmployer(client, job) {
        try {
            const arbeitsort = job.arbeitsort || {};
            
            // Generate employer hash for lookup
            const employerHash = await this.generateEmployerHash(
                client,
                job.arbeitgeber,
                arbeitsort.plz?.toString(),
                arbeitsort.ort
            );
            
            // Check if employer exists (using normalized_name instead of arbeitgeber_hash)
            const normalizedName = job.arbeitgeber.toLowerCase().trim();
            const existsQuery = 'SELECT id FROM job_scrp_employers WHERE normalized_name = $1';
            const existsResult = await client.query(existsQuery, [normalizedName]);
            
            if (existsResult.rows.length > 0) {
                // Update existing employer with fresh API data
                const employerId = existsResult.rows[0].id;
                await this.updateEmployerFromApi(client, employerId, job);
                this.stats.updatedEmployers++;
                return { id: employerId };
            } else {
                // Create new employer
                const employerId = await this.createEmployerFromApi(client, job);
                this.stats.newEmployers++;
                return { id: employerId };
            }
            
        } catch (error) {
            console.error(`❌ Error processing employer ${job.arbeitgeber}:`, error.message);
            return null;
        }
    }
    
    /**
     * Generate employer hash
     */
    async generateEmployerHash(client, arbeitgeber, plz, ort) {
        const hashQuery = 'SELECT generate_employer_hash($1, $2, $3) as hash';
        const result = await client.query(hashQuery, [arbeitgeber, plz, ort]);
        return result.rows[0].hash;
    }
    
    /**
     * Create new employer from API data
     */
    async createEmployerFromApi(client, job) {
        const arbeitsort = job.arbeitsort || {};
        
        const insertQuery = `
            INSERT INTO job_scrp_employers (
                name, normalized_name, first_seen, last_updated
            ) VALUES (
                $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            ) RETURNING id
        `;
        
        const normalizedName = job.arbeitgeber.toLowerCase().trim();
        
        const result = await client.query(insertQuery, [
            job.arbeitgeber,
            normalizedName
        ]);
        
        return result.rows[0].id;
    }
    
    /**
     * Update existing employer with fresh API data
     */
    async updateEmployerFromApi(client, employerId, job) {
        // Simply update the last_updated timestamp for existing job_scrp_employers
        const updateQuery = `
            UPDATE job_scrp_employers SET
                last_updated = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        
        await client.query(updateQuery, [employerId]);
    }
    
    /**
     * Calculate API data completeness (location-based)
     */
    calculateApiDataCompleteness(arbeitsort) {
        let score = 0;
        
        if (arbeitsort.plz) score += 20;
        if (arbeitsort.ort) score += 15;
        if (arbeitsort.strasse) score += 15;
        if (arbeitsort.region) score += 10;
        if (arbeitsort.koordinaten?.lat && arbeitsort.koordinaten?.lon) score += 20;
        if (arbeitsort.land) score += 5;
        
        return Math.min(score, 85); // Max 85 for API-only data (no email/website)
    }
    
    /**
     * Check if job position already exists
     */
    async checkExistingPosition(client, employerId, titel, beruf, jobType) {
        const positionHash = await this.generatePositionHash(client, employerId, titel, beruf, jobType);
        
        const checkQuery = 'SELECT id, times_seen FROM job_positions WHERE position_hash = $1';
        const result = await client.query(checkQuery, [positionHash]);
        
        return result.rows.length > 0 ? result.rows[0] : null;
    }
    
    /**
     * Generate position hash
     */
    async generatePositionHash(client, employerId, titel, beruf, jobType) {
        const hashQuery = 'SELECT generate_position_hash($1, $2, $3, $4) as hash';
        const result = await client.query(hashQuery, [employerId, titel, beruf, jobType]);
        return result.rows[0].hash;
    }
    
    /**
     * Create new job position
     */
    async createNewPosition(client, employerId, job) {
        const positionHash = await this.generatePositionHash(
            client, 
            employerId, 
            job.titel, 
            job.beruf, 
            this.jobType
        );
        
        const insertQuery = `
            INSERT INTO job_positions (
                employer_id, titel, beruf, job_type, position_hash,
                eintrittsdatum, aktuelleVeroeffentlichungsdatum,
                data_sources
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            )
        `;
        
        const dataSources = JSON.stringify(['api']);
        
        await client.query(insertQuery, [
            employerId,
            job.titel,
            job.beruf,
            this.jobType,
            positionHash,
            job.eintrittsdatum,
            job.aktuelleVeroeffentlichungsdatum,
            dataSources
        ]);
    }
    
    /**
     * Update existing position (increment times_seen)
     */
    async updateExistingPosition(client, positionId) {
        const updateQuery = `
            UPDATE job_positions 
            SET times_seen = times_seen + 1,
                last_seen = CURRENT_TIMESTAMP,
                data_sources = CASE 
                    WHEN data_sources ? 'api' THEN data_sources 
                    ELSE data_sources || '["api"]'::jsonb 
                END
            WHERE id = $1
        `;
        
        await client.query(updateQuery, [positionId]);
    }
    
    /**
     * Store complete API record in job_scrp_arbeitsagentur_jobs_v2
     */
    async storeApiRecord(client, job, employerId) {
        const arbeitsort = job.arbeitsort || {};
        
        // Check if record already exists (by refnr)
        const existsQuery = 'SELECT id FROM job_scrp_arbeitsagentur_jobs_v2 WHERE refnr = $1';
        const existsResult = await client.query(existsQuery, [job.refnr]);
        
        if (existsResult.rows.length > 0) {
            // Update existing record
            const updateQuery = `
                UPDATE job_scrp_arbeitsagentur_jobs_v2 
                SET modifikationsTimestamp = $1,
                    last_updated = CURRENT_TIMESTAMP,
                    last_seen_in_api = CURRENT_TIMESTAMP,
                    api_check_count = api_check_count + 1,
                    is_active = true,
                    old = CASE 
                        WHEN aktuelleveroeffentlichungsdatum < CURRENT_TIMESTAMP - INTERVAL '7 days' THEN true
                        ELSE false
                    END
                WHERE refnr = $2
            `;
            
            await client.query(updateQuery, [job.modifikationsTimestamp, job.refnr]);
        } else {
            // Insert new record
            const insertQuery = `
                INSERT INTO job_scrp_arbeitsagentur_jobs_v2 (
                    refnr, titel, beruf, arbeitgeber,
                    arbeitsort_plz, arbeitsort_ort, arbeitsort_region,
                    arbeitsort_strasse, arbeitsort_land,
                    arbeitsort_koordinaten_lat, arbeitsort_koordinaten_lon,
                    aktuelleVeroeffentlichungsdatum, eintrittsdatum,
                    modifikationsTimestamp, externeUrl,
                    kundennummerHash, raw_api_response, 
                    api_query_params, data_source,
                    last_seen_in_api, api_check_count, is_active, old
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                    CURRENT_TIMESTAMP, 1, true, false
                )
            `;
            
            await client.query(insertQuery, [
                job.refnr,
                job.titel,
                job.beruf,
                job.arbeitgeber,
                arbeitsort.plz?.toString(),
                arbeitsort.ort,
                arbeitsort.region,
                arbeitsort.strasse,
                arbeitsort.land || 'Deutschland',
                arbeitsort.koordinaten?.lat,
                arbeitsort.koordinaten?.lon,
                job.aktuelleVeroeffentlichungsdatum,
                job.eintrittsdatum,
                job.modifikationsTimestamp,
                job.externeUrl,
                job.kundennummerHash,
                JSON.stringify(job),
                JSON.stringify({ 
                    angebotsart: this.angebotsart, 
                    veroeffentlichtseit: this.publishedSince 
                }),
                'api'
            ]);
        }
    }
    
    /**
     * Print progress statistics
     */
    printProgress() {
        const elapsed = Math.round((new Date() - this.stats.startTime) / 1000);
        const rate = Math.round(this.stats.processedPostcodes / elapsed);
        
        console.log(`\n📈 ${this.jobType.toUpperCase()} SCRAPING PROGRESS:`);
        console.log(`   Postal codes: ${this.stats.processedPostcodes}`);
        console.log(`   API calls: ${this.stats.totalApiCalls}`);
        console.log(`   Jobs found: ${this.stats.totalJobsFound}`);
        console.log(`   New job_scrp_employers: ${this.stats.newEmployers}`);
        console.log(`   Updated job_scrp_employers: ${this.stats.updatedEmployers}`);
        console.log(`   New positions: ${this.stats.newPositions}`);
        console.log(`   Skipped duplicates: ${this.stats.skippedDuplicates}`);
        console.log(`   Errors: ${this.stats.errorCount}`);
        console.log(`   Rate: ${rate} postcodes/sec`);
    }
    
    /**
     * Print final statistics
     */
    async printFinalStats() {
        const duration = Math.round((new Date() - this.stats.startTime) / 1000);
        
        console.log(`\n📊 ${this.jobType.toUpperCase()} SCRAPING COMPLETED`);
        console.log(`==================================`);
        console.log(`Session: ${this.sessionId}`);
        console.log(`Duration: ${duration} seconds`);
        console.log(`Processed postal codes: ${this.stats.processedPostcodes}`);
        console.log(`Total API calls: ${this.stats.totalApiCalls}`);
        console.log(`Total jobs found: ${this.stats.totalJobsFound}`);
        console.log(`New job_scrp_employers: ${this.stats.newEmployers}`);
        console.log(`Updated job_scrp_employers: ${this.stats.updatedEmployers}`);
        console.log(`New positions: ${this.stats.newPositions}`);
        console.log(`Skipped duplicates: ${this.stats.skippedDuplicates}`);
        console.log(`Errors: ${this.stats.errorCount}`);
        console.log(`Efficiency: ${(this.stats.newPositions / Math.max(this.stats.totalJobsFound, 1) * 100).toFixed(1)}% new positions`);
        console.log(`Duplicate rate: ${(this.stats.skippedDuplicates / Math.max(this.stats.totalJobsFound, 1) * 100).toFixed(1)}%`);
    }
    
    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in other scripts
module.exports = IntelligentJobScraper;

// Example usage if run directly
if (require.main === module) {
    async function runExample() {
        console.log('🚀 Example: Running intelligent scraping for both job types...\n');
        
        try {
            // 1. Job scraping (28 days initial)
            console.log('📋 Starting JOB scraping (28 days)...');
            const jobScraper = new IntelligentJobScraper('job', 28);
            await jobScraper.runIntelligentScraping(50); // 50 postal codes
            
            // 2. Ausbildung scraping (28 days initial)  
            console.log('\n🎓 Starting AUSBILDUNG scraping (28 days)...');
            const ausbildungScraper = new IntelligentJobScraper('ausbildung', 28);
            await ausbildungScraper.runIntelligentScraping(50); // 50 postal codes
            
            console.log('\n🎉 Dual scraping completed successfully!');
            
        } catch (error) {
            console.error('❌ Dual scraping failed:', error.message);
        } finally {
            await pool.end();
        }
    }
    
    runExample();
}