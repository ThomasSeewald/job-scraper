const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Import the detail scraper
const JobDetailScraper = require('./job-detail-scraper');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class EnhancedIntelligentJobScraper {
    constructor(jobType = 'job', publishedSince = 28, enableDetailScraping = true) {
        this.jobType = jobType; // 'job' or 'ausbildung'
        this.angebotsart = jobType === 'ausbildung' ? 4 : 1; // 1=Jobs, 4=Ausbildung
        this.publishedSince = publishedSince; // 28 initial, 7 daily
        this.enableDetailScraping = enableDetailScraping;
        
        this.sessionId = this.generateSessionId();
        this.apiConfig = config.arbeitsagentur;
        
        // Initialize detail scraper if enabled
        if (this.enableDetailScraping) {
            this.detailScraper = new JobDetailScraper();
        }
        
        this.stats = {
            processedPostcodes: 0,
            totalApiCalls: 0,
            totalJobsFound: 0,
            newEmployers: 0,
            updatedEmployers: 0,
            newPositions: 0,
            skippedDuplicates: 0,
            errorCount: 0,
            // Detail scraping stats
            detailsAttempted: 0,
            detailsSuccessful: 0,
            detailsWithContact: 0,
            detailsWithCaptcha: 0,
            detailErrors: 0,
            startTime: new Date()
        };
        
        console.log(`🚀 Enhanced Intelligent ${jobType.toUpperCase()} Scraper initialized`);
        console.log(`📅 Scanning jobs published in last ${publishedSince} days`);
        console.log(`🔍 Detail scraping: ${enableDetailScraping ? 'ENABLED' : 'DISABLED'}`);
        console.log(`🆔 Session: ${this.sessionId}`);
    }
    
    generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `${this.jobType}-enhanced-${this.publishedSince}d-${timestamp}-${randomSuffix}`;
    }
    
    /**
     * Run enhanced scraping with detail page integration
     */
    async runEnhancedScraping(postcodeLimit = 100, detailScrapeInterval = 5) {
        console.log(`\n🚀 Starting enhanced ${this.jobType} scraping...`);
        console.log(`📊 Target: ${postcodeLimit} postal codes`);
        if (this.enableDetailScraping) {
            console.log(`🔍 Detail scraping every ${detailScrapeInterval} new jobs`);
        }
        
        try {
            // Get postal codes (prioritize high-activity areas)
            const postalCodes = await this.getOptimizedPostalCodes(postcodeLimit);
            
            console.log(`📋 Processing ${postalCodes.length} optimized postal codes`);
            
            // Log which postal codes we're processing
            const plzList = postalCodes.map(p => `${p.postal_code}(${p.city})`).slice(0, 10);
            console.log(`🎯 Top PLZ: ${plzList.join(', ')}${postalCodes.length > 10 ? '...' : ''}`);
            
            let newJobsForDetailScraping = [];
            
            for (const [index, postcodeData] of postalCodes.entries()) {
                console.log(`\n[${index + 1}/${postalCodes.length}] Scanning ${postcodeData.postal_code} (${postcodeData.city})`);
                
                // Query API with intelligence
                const apiResult = await this.queryJobsForPostcode(postcodeData.postal_code);
                
                if (apiResult.success && apiResult.jobs.length > 0) {
                    // Process with intelligent duplicate detection
                    const newJobs = await this.processJobsIntelligently(apiResult.jobs, postcodeData);
                    
                    // Add new jobs to detail scraping queue
                    if (this.enableDetailScraping && newJobs.length > 0) {
                        newJobsForDetailScraping.push(...newJobs);
                        
                        // Perform detail scraping when we hit the interval
                        if (newJobsForDetailScraping.length >= detailScrapeInterval) {
                            console.log(`\n🔍 Starting detail scraping for ${newJobsForDetailScraping.length} new jobs...`);
                            await this.performBatchDetailScraping(newJobsForDetailScraping.splice(0, detailScrapeInterval));
                        }
                    }
                }
                
                this.stats.processedPostcodes++;
                
                // Rate limiting
                if (index < postalCodes.length - 1) {
                    await this.delay(config.scraping.delayBetweenRequests);
                }
                
                // Progress report every 10 postal codes for better visibility
                if ((index + 1) % 10 === 0) {
                    this.printEnhancedProgress();
                }
            }
            
            // Process any remaining jobs for detail scraping
            if (this.enableDetailScraping && newJobsForDetailScraping.length > 0) {
                console.log(`\n🔍 Final detail scraping for remaining ${newJobsForDetailScraping.length} jobs...`);
                await this.performBatchDetailScraping(newJobsForDetailScraping);
            }
            
            await this.printEnhancedFinalStats();
            return this.stats;
            
        } catch (error) {
            console.error('❌ Enhanced scraping failed:', error.message);
            throw error;
        } finally {
            // Cleanup detail scraper
            if (this.enableDetailScraping && this.detailScraper) {
                await this.detailScraper.cleanup();
            }
        }
    }
    
    /**
     * Perform batch detail scraping for new jobs
     */
    async performBatchDetailScraping(jobReferences, maxBatchSize = 5) {
        if (!this.enableDetailScraping || !jobReferences.length) return;
        
        console.log(`\n🔍 Detail scraping batch: ${jobReferences.length} jobs`);
        
        for (let i = 0; i < jobReferences.length; i += maxBatchSize) {
            const batch = jobReferences.slice(i, i + maxBatchSize);
            console.log(`\n📋 Processing detail batch ${Math.floor(i/maxBatchSize) + 1}: ${batch.length} jobs`);
            
            for (const refNumber of batch) {
                await this.scrapeAndStoreJobDetails(refNumber);
                
                // Small delay between detail scrapes to avoid being blocked
                await this.delay(2000);
            }
            
            // Longer delay between batches
            if (i + maxBatchSize < jobReferences.length) {
                console.log('⏳ Waiting 10 seconds between detail batches...');
                await this.delay(10000);
            }
        }
    }
    
    /**
     * Scrape and store individual job details (skip jobs with external URLs)
     */
    async scrapeAndStoreJobDetails(referenceNumber) {
        const startTime = Date.now();
        this.stats.detailsAttempted++;
        
        try {
            // Check if job has external URL - skip if it does
            const client = await pool.connect();
            try {
                const checkQuery = 'SELECT externeurl FROM job_scrp_arbeitsagentur_jobs_v2 WHERE refnr = $1';
                const checkResult = await client.query(checkQuery, [referenceNumber]);
                
                if (checkResult.rows.length > 0 && checkResult.rows[0].externeurl) {
                    console.log(`⏭️ Skipping detail scraping for ${referenceNumber}: Has external URL (${checkResult.rows[0].externeurl})`);
                    this.stats.detailsAttempted--; // Don't count skipped jobs
                    return;
                }
            } finally {
                client.release();
            }
            
            console.log(`🔍 Detail scraping: ${referenceNumber}`);
            
            // Scrape job details
            const details = await this.detailScraper.scrapeJobDetails(referenceNumber);
            const duration = Date.now() - startTime;
            
            if (details.error) {
                console.log(`❌ Detail scraping failed for ${referenceNumber}: ${details.error}`);
                await this.logDetailScraping(referenceNumber, 'error', duration, details.error);
                this.stats.detailErrors++;
                return;
            }
            
            // Store details in database
            await this.storeJobDetails(details, duration);
            
            // Update stats
            this.stats.detailsSuccessful++;
            if (details.metadata.hasContact) {
                this.stats.detailsWithContact++;
            }
            
            console.log(`✅ Detail scraped: ${referenceNumber} (${duration}ms, contact: ${details.metadata.hasContact})`);
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Detail scraping error for ${referenceNumber}:`, error.message);
            await this.logDetailScraping(referenceNumber, 'error', duration, error.message);
            this.stats.detailErrors++;
        }
    }
    
    /**
     * Store job details in database
     */
    async storeJobDetails(details, scrapingDuration) {
        const client = await pool.connect();
        
        try {
            // Get arbeitsagentur_job_id
            const jobQuery = 'SELECT id FROM job_scrp_arbeitsagentur_jobs_v2 WHERE refnr = $1';
            const jobResult = await client.query(jobQuery, [details.referenceNumber]);
            const arbeitsagenturJobId = jobResult.rows.length > 0 ? jobResult.rows[0].id : null;
            
            // Calculate data completeness score
            const completenessScore = this.calculateCompletenessScore(details);
            
            // Store job details
            const insertQuery = `
                INSERT INTO job_scrp_job_details (
                    reference_number, arbeitsagentur_job_id,
                    full_description, requirements, benefits, skills,
                    contact_email, contact_phone, contact_website, contact_person,
                    application_url, application_email, application_instructions,
                    job_type, contract_type,
                    scraped_at, scraping_duration_ms, scraping_success,
                    has_contact_info, text_length, data_completeness_score,
                    raw_page_text, source_url
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    CURRENT_TIMESTAMP, $16, $17, $18, $19, $20, $21, $22
                )
                ON CONFLICT (reference_number) 
                DO UPDATE SET
                    full_description = EXCLUDED.full_description,
                    requirements = EXCLUDED.requirements,
                    benefits = EXCLUDED.benefits,
                    skills = EXCLUDED.skills,
                    contact_email = EXCLUDED.contact_email,
                    contact_phone = EXCLUDED.contact_phone,
                    contact_website = EXCLUDED.contact_website,
                    contact_person = EXCLUDED.contact_person,
                    application_url = EXCLUDED.application_url,
                    application_email = EXCLUDED.application_email,
                    application_instructions = EXCLUDED.application_instructions,
                    job_type = EXCLUDED.job_type,
                    contract_type = EXCLUDED.contract_type,
                    scraped_at = CURRENT_TIMESTAMP,
                    scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                    scraping_success = EXCLUDED.scraping_success,
                    has_contact_info = EXCLUDED.has_contact_info,
                    text_length = EXCLUDED.text_length,
                    data_completeness_score = EXCLUDED.data_completeness_score,
                    raw_page_text = EXCLUDED.raw_page_text,
                    source_url = EXCLUDED.source_url,
                    updated_at = CURRENT_TIMESTAMP
            `;
            
            await client.query(insertQuery, [
                details.referenceNumber,
                arbeitsagenturJobId,
                details.description,
                details.requirements,
                details.jobDetails.benefits || [],
                details.jobDetails.skills || [],
                details.contact.email,
                details.contact.phone,
                details.contact.website,
                details.contact.person,
                details.application.url,
                details.application.email,
                details.application.instructions,
                details.jobDetails.type,
                details.jobDetails.contractType,
                scrapingDuration,
                true, // scraping_success
                details.metadata.hasContact,
                details.metadata.textLength,
                completenessScore,
                details.rawText || null,
                details.metadata.sourceUrl
            ]);
            
            // Log successful detail scraping
            await this.logDetailScraping(
                details.referenceNumber, 
                'success', 
                scrapingDuration, 
                null,
                details
            );
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Calculate data completeness score
     */
    calculateCompletenessScore(details) {
        let score = 0;
        
        // Basic information (40 points)
        if (details.description && details.description.length > 100) score += 20;
        if (details.requirements && details.requirements.length > 50) score += 15;
        if (details.title && details.title !== 'No title found') score += 5;
        
        // Contact information (30 points)
        if (details.contact.email) score += 15;
        if (details.contact.phone) score += 10;
        if (details.contact.website) score += 5;
        
        // Application information (20 points)
        if (details.application.url) score += 10;
        if (details.application.email) score += 5;
        if (details.application.instructions) score += 5;
        
        // Additional details (10 points)
        if (details.jobDetails.type) score += 3;
        if (details.jobDetails.contractType) score += 3;
        if (details.jobDetails.benefits && details.jobDetails.benefits.length > 0) score += 2;
        if (details.jobDetails.skills && details.jobDetails.skills.length > 0) score += 2;
        
        return Math.min(score, 100);
    }
    
    /**
     * Log detail scraping attempt
     */
    async logDetailScraping(referenceNumber, status, duration, errorMessage = null, details = null) {
        const client = await pool.connect();
        
        try {
            const logQuery = `
                INSERT INTO detail_scraping_log (
                    session_id, reference_number, status, duration_ms,
                    email_found, phone_found, website_found,
                    description_length, requirements_length,
                    benefits_count, skills_count,
                    error_message, source_url
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `;
            
            await client.query(logQuery, [
                this.sessionId,
                referenceNumber,
                status,
                duration,
                details ? !!details.contact.email : false,
                details ? !!details.contact.phone : false,
                details ? !!details.contact.website : false,
                details ? (details.description ? details.description.length : 0) : 0,
                details ? (details.requirements ? details.requirements.length : 0) : 0,
                details ? (details.jobDetails.benefits ? details.jobDetails.benefits.length : 0) : 0,
                details ? (details.jobDetails.skills ? details.jobDetails.skills.length : 0) : 0,
                errorMessage,
                details ? details.metadata.sourceUrl : null
            ]);
        } finally {
            client.release();
        }
    }
    
    // Include all methods from original IntelligentJobScraper
    async getOptimizedPostalCodes(limit) {
        const client = await pool.connect();
        
        try {
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
                    SELECT arbeitsort_plz, COUNT(*) as count 
                    FROM job_scrp_employers 
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
    
    async queryJobsForPostcode(postalCode) {
        const startTime = Date.now();
        
        try {
            const params = {
                size: 100,
                page: 1,
                wo: postalCode,
                umkreis: 5,
                angebotsart: this.angebotsart,
                veroeffentlichtseit: this.publishedSince
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
    
    async processJobsIntelligently(jobs, postcodeData) {
        const client = await pool.connect();
        const newJobs = [];
        
        try {
            for (const job of jobs) {
                try {
                    await client.query('BEGIN');
                    const isNewJob = await this.processJobIntelligently(client, job, postcodeData);
                    if (isNewJob && job.refnr) {
                        newJobs.push(job.refnr);
                    }
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
        
        return newJobs;
    }
    
    async processJobIntelligently(client, job, postcodeData) {
        try {
            if (!job.arbeitgeber || !job.titel || !job.beruf) {
                console.warn(`⚠️ Skip job ${job.refnr}: Missing essential data`);
                return false;
            }
            
            const employer = await this.findOrCreateEmployer(client, job);
            if (!employer) {
                console.warn(`⚠️ Could not process employer for job ${job.refnr}`);
                return false;
            }
            
            const existingPosition = await this.checkExistingPosition(
                client, employer.id, job.titel, job.beruf, this.jobType
            );
            
            let isNewJob = false;
            
            if (existingPosition) {
                await this.updateExistingPosition(client, existingPosition.id);
                this.stats.skippedDuplicates++;
                console.log(`⏭️ Skip: ${job.titel} bei ${job.arbeitgeber} (bereits bekannt)`);
            } else {
                await this.createNewPosition(client, employer.id, job);
                this.stats.newPositions++;
                console.log(`➕ Neu: ${job.titel} bei ${job.arbeitgeber}`);
                isNewJob = true;
            }
            
            await this.storeApiRecord(client, job, employer.id);
            return isNewJob;
            
        } catch (error) {
            console.error(`❌ Error processing job ${job.refnr}:`, error.message);
            return false;
        }
    }
    
    // Import remaining methods from original class...
    async findOrCreateEmployer(client, job) {
        try {
            const arbeitsort = job.arbeitsort || {};
            
            const employerHash = await this.generateEmployerHash(
                client,
                job.arbeitgeber,
                arbeitsort.plz?.toString(),
                arbeitsort.ort
            );
            
            const existsQuery = 'SELECT id FROM job_scrp_employers WHERE arbeitgeber_hash = $1';
            const existsResult = await client.query(existsQuery, [employerHash]);
            
            if (existsResult.rows.length > 0) {
                const employerId = existsResult.rows[0].id;
                await this.updateEmployerFromApi(client, employerId, job);
                this.stats.updatedEmployers++;
                return { id: employerId };
            } else {
                const employerId = await this.createEmployerFromApi(client, job, employerHash);
                this.stats.newEmployers++;
                return { id: employerId };
            }
            
        } catch (error) {
            console.error(`❌ Error processing employer ${job.arbeitgeber}:`, error.message);
            return null;
        }
    }
    
    async generateEmployerHash(client, arbeitgeber, plz, ort) {
        const hashQuery = 'SELECT generate_employer_hash($1, $2, $3) as hash';
        const result = await client.query(hashQuery, [arbeitgeber, plz, ort]);
        return result.rows[0].hash;
    }
    
    async createEmployerFromApi(client, job, employerHash) {
        const arbeitsort = job.arbeitsort || {};
        
        const insertQuery = `
            INSERT INTO job_scrp_employers (
                arbeitgeber, arbeitgeber_hash,
                arbeitsort_plz, arbeitsort_ort, arbeitsort_region, 
                arbeitsort_strasse, arbeitsort_land,
                avg_latitude, avg_longitude,
                data_completeness_score, data_sources
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            ) RETURNING id
        `;
        
        const dataCompleteness = this.calculateApiDataCompleteness(arbeitsort);
        const dataSources = JSON.stringify(['api']);
        
        const result = await client.query(insertQuery, [
            job.arbeitgeber,
            employerHash,
            arbeitsort.plz?.toString(),
            arbeitsort.ort,
            arbeitsort.region,
            arbeitsort.strasse,
            arbeitsort.land || 'Deutschland',
            arbeitsort.koordinaten?.lat,
            arbeitsort.koordinaten?.lon,
            dataCompleteness,
            dataSources
        ]);
        
        return result.rows[0].id;
    }
    
    async updateEmployerFromApi(client, employerId, job) {
        const arbeitsort = job.arbeitsort || {};
        
        const updateQuery = `
            UPDATE job_scrp_employers SET
                arbeitsort_strasse = COALESCE(NULLIF($1, ''), arbeitsort_strasse),
                avg_latitude = COALESCE($2, avg_latitude),
                avg_longitude = COALESCE($3, avg_longitude),
                data_sources = CASE 
                    WHEN data_sources ? 'api' THEN data_sources 
                    ELSE data_sources || '[\"api\"]'::jsonb 
                END,
                last_updated = CURRENT_TIMESTAMP
            WHERE id = $4
        `;
        
        await client.query(updateQuery, [
            arbeitsort.strasse,
            arbeitsort.koordinaten?.lat,
            arbeitsort.koordinaten?.lon,
            employerId
        ]);
    }
    
    calculateApiDataCompleteness(arbeitsort) {
        let score = 0;
        
        if (arbeitsort.plz) score += 20;
        if (arbeitsort.ort) score += 15;
        if (arbeitsort.strasse) score += 15;
        if (arbeitsort.region) score += 10;
        if (arbeitsort.koordinaten?.lat && arbeitsort.koordinaten?.lon) score += 20;
        if (arbeitsort.land) score += 5;
        
        return Math.min(score, 85);
    }
    
    async checkExistingPosition(client, employerId, titel, beruf, jobType) {
        const positionHash = await this.generatePositionHash(client, employerId, titel, beruf, jobType);
        
        const checkQuery = 'SELECT id, times_seen FROM job_positions WHERE position_hash = $1';
        const result = await client.query(checkQuery, [positionHash]);
        
        return result.rows.length > 0 ? result.rows[0] : null;
    }
    
    async generatePositionHash(client, employerId, titel, beruf, jobType) {
        const hashQuery = 'SELECT generate_position_hash($1, $2, $3, $4) as hash';
        const result = await client.query(hashQuery, [employerId, titel, beruf, jobType]);
        return result.rows[0].hash;
    }
    
    async createNewPosition(client, employerId, job) {
        const positionHash = await this.generatePositionHash(
            client, employerId, job.titel, job.beruf, this.jobType
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
    
    async updateExistingPosition(client, positionId) {
        const updateQuery = `
            UPDATE job_positions 
            SET times_seen = times_seen + 1,
                last_seen = CURRENT_TIMESTAMP,
                data_sources = CASE 
                    WHEN data_sources ? 'api' THEN data_sources 
                    ELSE data_sources || '[\"api\"]'::jsonb 
                END
            WHERE id = $1
        `;
        
        await client.query(updateQuery, [positionId]);
    }
    
    async storeApiRecord(client, job, employerId) {
        const arbeitsort = job.arbeitsort || {};
        
        const existsQuery = 'SELECT id FROM job_scrp_arbeitsagentur_jobs_v2 WHERE refnr = $1';
        const existsResult = await client.query(existsQuery, [job.refnr]);
        
        if (existsResult.rows.length > 0) {
            const updateQuery = `
                UPDATE job_scrp_arbeitsagentur_jobs_v2 
                SET modifikationsTimestamp = $1,
                    last_updated = CURRENT_TIMESTAMP
                WHERE refnr = $2
            `;
            
            await client.query(updateQuery, [job.modifikationsTimestamp, job.refnr]);
        } else {
            const insertQuery = `
                INSERT INTO job_scrp_arbeitsagentur_jobs_v2 (
                    refnr, titel, beruf, arbeitgeber,
                    arbeitsort_plz, arbeitsort_ort, arbeitsort_region,
                    arbeitsort_strasse, arbeitsort_land,
                    arbeitsort_koordinaten_lat, arbeitsort_koordinaten_lon,
                    aktuelleVeroeffentlichungsdatum, eintrittsdatum,
                    modifikationsTimestamp, externeUrl,
                    kundennummerHash, raw_api_response, 
                    api_query_params, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
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
    
    printEnhancedProgress() {
        const elapsed = Math.round((new Date() - this.stats.startTime) / 1000);
        const rate = Math.round(this.stats.processedPostcodes / elapsed);
        
        console.log(`\n📈 ${this.jobType.toUpperCase()} ENHANCED PROGRESS:`);
        console.log(`   Postal codes: ${this.stats.processedPostcodes}`);
        console.log(`   API calls: ${this.stats.totalApiCalls}`);
        console.log(`   Jobs found: ${this.stats.totalJobsFound}`);
        console.log(`   New job_scrp_employers: ${this.stats.newEmployers}`);
        console.log(`   Updated job_scrp_employers: ${this.stats.updatedEmployers}`);
        console.log(`   New positions: ${this.stats.newPositions}`);
        console.log(`   Skipped duplicates: ${this.stats.skippedDuplicates}`);
        if (this.enableDetailScraping) {
            console.log(`   Details attempted: ${this.stats.detailsAttempted}`);
            console.log(`   Details successful: ${this.stats.detailsSuccessful}`);
            console.log(`   Details with contact: ${this.stats.detailsWithContact}`);
            console.log(`   Detail errors: ${this.stats.detailErrors}`);
        }
        console.log(`   Errors: ${this.stats.errorCount}`);
        console.log(`   Rate: ${rate} postcodes/sec`);
    }
    
    async printEnhancedFinalStats() {
        const duration = Math.round((new Date() - this.stats.startTime) / 1000);
        
        console.log(`\n📊 ${this.jobType.toUpperCase()} ENHANCED SCRAPING COMPLETED`);
        console.log(`==========================================`);
        console.log(`Session: ${this.sessionId}`);
        console.log(`Duration: ${duration} seconds`);
        console.log(`Processed postal codes: ${this.stats.processedPostcodes}`);
        console.log(`Total API calls: ${this.stats.totalApiCalls}`);
        console.log(`Total jobs found: ${this.stats.totalJobsFound}`);
        console.log(`New job_scrp_employers: ${this.stats.newEmployers}`);
        console.log(`Updated job_scrp_employers: ${this.stats.updatedEmployers}`);
        console.log(`New positions: ${this.stats.newPositions}`);
        console.log(`Skipped duplicates: ${this.stats.skippedDuplicates}`);
        
        if (this.enableDetailScraping) {
            console.log(`\n🔍 DETAIL SCRAPING RESULTS:`);
            console.log(`Details attempted: ${this.stats.detailsAttempted}`);
            console.log(`Details successful: ${this.stats.detailsSuccessful}`);
            console.log(`Details with contact: ${this.stats.detailsWithContact}`);
            console.log(`Detail errors: ${this.stats.detailErrors}`);
            
            const successRate = this.stats.detailsAttempted > 0 ? 
                (this.stats.detailsSuccessful / this.stats.detailsAttempted * 100).toFixed(1) : 0;
            const contactRate = this.stats.detailsSuccessful > 0 ? 
                (this.stats.detailsWithContact / this.stats.detailsSuccessful * 100).toFixed(1) : 0;
                
            console.log(`Detail success rate: ${successRate}%`);
            console.log(`Contact extraction rate: ${contactRate}%`);
        }
        
        console.log(`Errors: ${this.stats.errorCount}`);
        console.log(`Efficiency: ${(this.stats.newPositions / Math.max(this.stats.totalJobsFound, 1) * 100).toFixed(1)}% new positions`);
        console.log(`Duplicate rate: ${(this.stats.skippedDuplicates / Math.max(this.stats.totalJobsFound, 1) * 100).toFixed(1)}%`);
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = EnhancedIntelligentJobScraper;

// Example usage if run directly
if (require.main === module) {
    async function runEnhancedExample() {
        console.log('🚀 Example: Running enhanced scraping with detail extraction...\n');
        
        try {
            // Enhanced job scraping with detail extraction (2 days fresh)
            console.log('📋 Starting ENHANCED JOB scraping (2 days) with detail extraction...');
            const enhancedScraper = new EnhancedIntelligentJobScraper('job', 2, true);
            await enhancedScraper.runEnhancedScraping(25, 3); // 25 postal codes, detail scrape every 3 new jobs
            
            console.log('\n🎉 Enhanced scraping completed successfully!');
            
        } catch (error) {
            console.error('❌ Enhanced scraping failed:', error.message);
        } finally {
            await pool.end();
        }
    }
    
    runEnhancedExample();
}