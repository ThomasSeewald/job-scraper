const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('crypto').randomUUID || require('uuid').v4;

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;
const scrapingConfig = config.scraping;
const apiConfig = config.arbeitsagentur;

const pool = new Pool(dbConfig);

class ArbeitsagenturJobScraper {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.stats = {
            processedPostcodes: 0,
            totalJobsFound: 0,
            totalJobsInserted: 0,
            totalJobsUpdated: 0,
            totalJobsSkipped: 0,
            errorCount: 0,
            startTime: new Date()
        };
        
        console.log(`🚀 Job Scraper initialized with session ID: ${this.sessionId}`);
    }
    
    generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `scraper-${timestamp}-${randomSuffix}`;
    }
    
    /**
     * Get postal codes from database
     */
    async getPostalCodes(limit = 50, offset = 0) {
        const client = await pool.connect();
        try {
            const query = `
                SELECT postal_code, city, longitude, latitude 
                FROM our_sql_postal_code 
                WHERE postal_code IS NOT NULL 
                AND LENGTH(postal_code) = 5
                ORDER BY COALESCE(so_often_used, 0) DESC, RANDOM()
                LIMIT $1 OFFSET $2
            `;
            const result = await client.query(query, [limit, offset]);
            console.log(`📋 Retrieved ${result.rows.length} postal codes from database (offset: ${offset})`);
            return result.rows;
        } finally {
            client.release();
        }
    }
    
    /**
     * Query Arbeitsagentur API for a specific postal code
     */
    async queryJobsForPostcode(postalCode, options = {}) {
        const startTime = Date.now();
        
        try {
            const params = {
                ...apiConfig.defaultParams,
                wo: postalCode,
                ...options
            };
            
            console.log(`🔍 Querying jobs for postal code: ${postalCode}`);
            
            const response = await axios.get(apiConfig.baseURL, {
                headers: {
                    'X-API-Key': apiConfig.apiKey,
                    'User-Agent': apiConfig.userAgent,
                    'Accept': 'application/json'
                },
                params: params,
                timeout: scrapingConfig.timeout
            });
            
            const data = response.data;
            const jobCount = data.stellenangebote ? data.stellenangebote.length : 0;
            const duration = Date.now() - startTime;
            
            console.log(`✅ Found ${jobCount} jobs for ${postalCode} (${data.maxErgebnisse || 0} total available) - ${duration}ms`);
            
            // Log this scraping attempt
            await this.logScrapingAttempt(postalCode, {
                status: 'success',
                jobsFound: jobCount,
                totalAvailable: data.maxErgebnisse || 0,
                apiResponseCode: response.status,
                apiQueryParams: params,
                duration: Math.round(duration / 1000)
            });
            
            return {
                success: true,
                postalCode: postalCode,
                jobCount: jobCount,
                totalAvailable: data.maxErgebnisse || 0,
                jobs: data.stellenangebote || [],
                queryParams: params,
                rawResponse: data,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Error querying ${postalCode}:`, error.message);
            
            // Log this failed attempt
            await this.logScrapingAttempt(postalCode, {
                status: 'error',
                errorMessage: error.message,
                apiResponseCode: error.response?.status,
                duration: Math.round(duration / 1000)
            });
            
            return {
                success: false,
                postalCode: postalCode,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Save jobs to database
     */
    async saveJobsToDatabase(jobsData) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            let insertedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            
            for (const jobData of jobsData.jobs) {
                try {
                    const jobRecord = this.transformApiDataToDbRecord(jobData, jobsData);
                    
                    // Check if job already exists
                    const existsQuery = 'SELECT id FROM arbeitsagentur_jobs_api WHERE reference_number = $1';
                    const existsResult = await client.query(existsQuery, [jobRecord.reference_number]);
                    
                    if (existsResult.rows.length > 0) {
                        // Update existing job
                        const updateQuery = `
                            UPDATE arbeitsagentur_jobs_api 
                            SET title = $1, profession = $2, employer = $3, 
                                publication_date = $4, modification_timestamp = $5,
                                external_url = $6, raw_api_response = $7,
                                last_updated = CURRENT_TIMESTAMP
                            WHERE reference_number = $8
                        `;
                        
                        await client.query(updateQuery, [
                            jobRecord.title,
                            jobRecord.profession,
                            jobRecord.employer,
                            jobRecord.publication_date,
                            jobRecord.modification_timestamp,
                            jobRecord.external_url,
                            jobRecord.raw_api_response,
                            jobRecord.reference_number
                        ]);
                        
                        updatedCount++;
                        
                    } else {
                        // Insert new job
                        const insertQuery = `
                            INSERT INTO arbeitsagentur_jobs_api (
                                reference_number, title, profession, employer,
                                postal_code, city, region, street, country,
                                latitude, longitude, distance_km,
                                publication_date, entry_date, modification_timestamp,
                                external_url, company_hash, api_query_params,
                                raw_api_response, job_type
                            ) VALUES (
                                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                                $13, $14, $15, $16, $17, $18, $19, $20
                            )
                        `;
                        
                        await client.query(insertQuery, [
                            jobRecord.reference_number,
                            jobRecord.title,
                            jobRecord.profession,
                            jobRecord.employer,
                            jobRecord.postal_code,
                            jobRecord.city,
                            jobRecord.region,
                            jobRecord.street,
                            jobRecord.country,
                            jobRecord.latitude,
                            jobRecord.longitude,
                            jobRecord.distance_km,
                            jobRecord.publication_date,
                            jobRecord.entry_date,
                            jobRecord.modification_timestamp,
                            jobRecord.external_url,
                            jobRecord.company_hash,
                            jobRecord.api_query_params,
                            jobRecord.raw_api_response,
                            jobRecord.job_type
                        ]);
                        
                        insertedCount++;
                    }
                    
                } catch (jobError) {
                    console.error(`❌ Error saving job ${jobData.refnr}:`, jobError.message);
                    skippedCount++;
                }
            }
            
            await client.query('COMMIT');
            
            console.log(`💾 Database results: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped`);
            
            return { insertedCount, updatedCount, skippedCount };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Database transaction failed:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }
    
    /**
     * Transform API data to database record format
     */
    transformApiDataToDbRecord(apiJob, contextData) {
        const arbeitsort = apiJob.arbeitsort || {};
        
        return {
            reference_number: apiJob.refnr,
            title: apiJob.titel,
            profession: apiJob.beruf,
            employer: apiJob.arbeitgeber,
            postal_code: arbeitsort.plz,
            city: arbeitsort.ort,
            region: arbeitsort.region,
            street: arbeitsort.strasse,
            country: arbeitsort.land || 'Deutschland',
            latitude: arbeitsort.koordinaten?.lat,
            longitude: arbeitsort.koordinaten?.lon,
            distance_km: arbeitsort.entfernung ? parseInt(arbeitsort.entfernung) : null,
            publication_date: apiJob.aktuelleVeroeffentlichungsdatum,
            entry_date: apiJob.eintrittsdatum,
            modification_timestamp: apiJob.modifikationsTimestamp,
            external_url: apiJob.externeUrl,
            company_hash: apiJob.kundennummerHash,
            api_query_params: JSON.stringify(contextData.queryParams),
            raw_api_response: JSON.stringify(apiJob),
            job_type: this.determineJobType(contextData.queryParams)
        };
    }
    
    /**
     * Determine job type from query parameters
     */
    determineJobType(queryParams) {
        const angebotsart = queryParams.angebotsart;
        switch (angebotsart) {
            case 1: return 'job';
            case 4: return 'ausbildung';
            default: return 'unknown';
        }
    }
    
    /**
     * Log scraping attempt to database
     */
    async logScrapingAttempt(postalCode, logData) {
        const client = await pool.connect();
        try {
            const query = `
                INSERT INTO scraping_log (
                    session_id, postal_code, status, jobs_found, 
                    total_available, api_response_code, api_query_params,
                    error_message, duration_seconds, completed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
            `;
            
            await client.query(query, [
                this.sessionId,
                postalCode,
                logData.status,
                logData.jobsFound || 0,
                logData.totalAvailable || 0,
                logData.apiResponseCode,
                JSON.stringify(logData.apiQueryParams),
                logData.errorMessage,
                logData.duration
            ]);
            
        } catch (error) {
            console.error('❌ Failed to log scraping attempt:', error.message);
        } finally {
            client.release();
        }
    }
    
    /**
     * Process multiple postal codes
     */
    async processPostalCodes(postcodeLimit = 50, jobOptions = {}) {
        console.log(`🚀 Starting job scraping for ${postcodeLimit} postal codes...`);
        
        try {
            const postalCodes = await this.getPostalCodes(postcodeLimit);
            console.log(`📋 Processing ${postalCodes.length} postal codes`);
            
            for (const [index, postcodeData] of postalCodes.entries()) {
                console.log(`\n[${index + 1}/${postalCodes.length}] Processing ${postcodeData.postal_code} (${postcodeData.city})`);
                
                // Query API
                const result = await this.queryJobsForPostcode(postcodeData.postal_code, jobOptions);
                
                if (result.success && result.jobs.length > 0) {
                    // Save to database
                    const dbResult = await this.saveJobsToDatabase(result);
                    
                    // Update stats
                    this.stats.totalJobsFound += result.jobCount;
                    this.stats.totalJobsInserted += dbResult.insertedCount;
                    this.stats.totalJobsUpdated += dbResult.updatedCount;
                    this.stats.totalJobsSkipped += dbResult.skippedCount;
                }
                
                if (result.success) {
                    this.stats.processedPostcodes++;
                } else {
                    this.stats.errorCount++;
                }
                
                // Rate limiting
                if (index < postalCodes.length - 1) {
                    await this.delay(scrapingConfig.delayBetweenRequests);
                }
            }
            
            await this.printFinalStats();
            return this.stats;
            
        } catch (error) {
            console.error('❌ Fatal error in processPostalCodes:', error);
            throw error;
        }
    }
    
    /**
     * Print final statistics
     */
    async printFinalStats() {
        const endTime = new Date();
        const duration = Math.round((endTime - this.stats.startTime) / 1000);
        
        console.log(`\n📊 SCRAPING SESSION COMPLETED`);
        console.log(`=====================================`);
        console.log(`Session ID: ${this.sessionId}`);
        console.log(`Duration: ${duration} seconds`);
        console.log(`Processed postal codes: ${this.stats.processedPostcodes}`);
        console.log(`Total jobs found: ${this.stats.totalJobsFound}`);
        console.log(`Jobs inserted: ${this.stats.totalJobsInserted}`);
        console.log(`Jobs updated: ${this.stats.totalJobsUpdated}`);
        console.log(`Jobs skipped: ${this.stats.totalJobsSkipped}`);
        console.log(`Errors: ${this.stats.errorCount}`);
        console.log(`Success rate: ${((this.stats.processedPostcodes / (this.stats.processedPostcodes + this.stats.errorCount)) * 100).toFixed(1)}%`);
        
        // Get updated database stats
        const dbStats = await this.getDatabaseStats();
        console.log(`\n📊 Database totals: ${dbStats.total_jobs} jobs, ${dbStats.unique_postcodes} postal codes`);
    }
    
    async getDatabaseStats() {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(DISTINCT postal_code) as unique_postcodes,
                    COUNT(DISTINCT employer) as unique_employers
                FROM arbeitsagentur_jobs_api
            `);
            return result.rows[0];
        } finally {
            client.release();
        }
    }
    
    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Example usage function
async function runJobScraping() {
    const scraper = new ArbeitsagenturJobScraper();
    
    try {
        // Test run with 10 postal codes, looking for regular jobs
        await scraper.processPostalCodes(10, {
            size: 100,        // Get up to 100 jobs per postal code
            angebotsart: 1,   // 1 = Jobs, 4 = Ausbildung
            umkreis: 5        // 5km radius
        });
        
        console.log('\n✅ Job scraping completed successfully!');
        
    } catch (error) {
        console.error('❌ Job scraping failed:', error.message);
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    runJobScraping();
}

module.exports = ArbeitsagenturJobScraper;