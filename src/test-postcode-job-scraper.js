const axios = require('axios');
const { Pool } = require('pg');

// Database configuration
const dbConfig = {
    host: 'localhost',
    port: 5473,
    database: 'jetzt',
    user: 'odoo',
    password: 'odoo',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

const pool = new Pool(dbConfig);

// Arbeitsagentur API configuration
const API_CONFIG = {
    baseURL: 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs',
    headers: {
        'X-API-Key': 'jobboerse-jobsuche',
        'User-Agent': 'jobboerse-jobsuche',
        'Accept': 'application/json'
    }
};

class PostcodeJobScraper {
    constructor() {
        this.results = [];
        this.processedCount = 0;
        this.errorCount = 0;
    }

    /**
     * Get postal codes from database
     */
    async getPostalCodes(limit = 50) {
        const client = await pool.connect();
        try {
            const query = `
                SELECT postal_code, city, longitude, latitude 
                FROM our_sql_postal_code 
                WHERE postal_code IS NOT NULL 
                AND LENGTH(postal_code) = 5
                ORDER BY RANDOM()
                LIMIT $1
            `;
            const result = await client.query(query, [limit]);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Query Arbeitsagentur API for a specific postal code
     */
    async queryJobsForPostcode(postalCode, options = {}) {
        try {
            const params = {
                size: options.size || 100,
                page: options.page || 1,
                wo: postalCode,
                umkreis: options.radius || 0,
                angebotsart: options.jobType || 4, // 4 = Ausbildung, 1 = Jobs
                ...options.extraParams
            };

            console.log(`🔍 Querying jobs for postal code: ${postalCode}`);
            
            const response = await axios.get(API_CONFIG.baseURL, {
                headers: API_CONFIG.headers,
                params: params,
                timeout: 60000
            });

            const data = response.data;
            const jobCount = data.stellenangebote ? data.stellenangebote.length : 0;
            
            console.log(`✅ Found ${jobCount} jobs for ${postalCode} (${data.maxErgebnisse} total available)`);
            
            return {
                success: true,
                postalCode: postalCode,
                jobCount: jobCount,
                totalAvailable: data.maxErgebnisse || 0,
                jobs: data.stellenangebote || [],
                queryParams: params,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error querying ${postalCode}:`, error.message);
            return {
                success: false,
                postalCode: postalCode,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Process multiple postal codes
     */
    async processPostalCodes(postcodeLimit = 10, jobOptions = {}) {
        console.log(`🚀 Starting postal code job scraper for ${postcodeLimit} postal codes...`);
        
        try {
            // Get postal codes from database
            const postalCodes = await this.getPostalCodes(postcodeLimit);
            console.log(`📋 Retrieved ${postalCodes.length} postal codes from database`);

            // Process each postal code
            for (const postcodeData of postalCodes) {
                const result = await this.queryJobsForPostcode(postcodeData.postal_code, jobOptions);
                
                this.results.push({
                    ...result,
                    city: postcodeData.city,
                    coordinates: {
                        lat: postcodeData.latitude,
                        lon: postcodeData.longitude
                    }
                });

                if (result.success) {
                    this.processedCount++;
                } else {
                    this.errorCount++;
                }

                // Add delay between requests to be respectful to the API
                await this.delay(1000);
            }

            console.log(`\n📊 Processing completed:`);
            console.log(`   ✅ Successful: ${this.processedCount}`);
            console.log(`   ❌ Errors: ${this.errorCount}`);
            console.log(`   📈 Total results: ${this.results.length}`);

            return this.results;

        } catch (error) {
            console.error('❌ Fatal error in processPostalCodes:', error);
            throw error;
        }
    }

    /**
     * Get summary statistics
     */
    getSummary() {
        const successful = this.results.filter(r => r.success);
        const totalJobs = successful.reduce((sum, r) => sum + r.jobCount, 0);
        const totalAvailable = successful.reduce((sum, r) => sum + r.totalAvailable, 0);
        const avgJobsPerPostcode = successful.length > 0 ? (totalJobs / successful.length).toFixed(1) : 0;

        return {
            processedPostcodes: successful.length,
            errorCount: this.errorCount,
            totalJobsRetrieved: totalJobs,
            totalJobsAvailable: totalAvailable,
            averageJobsPerPostcode: avgJobsPerPostcode,
            topPostcodes: successful
                .sort((a, b) => b.totalAvailable - a.totalAvailable)
                .slice(0, 5)
                .map(r => ({
                    postalCode: r.postalCode,
                    city: r.city,
                    totalJobs: r.totalAvailable,
                    retrieved: r.jobCount
                }))
        };
    }

    /**
     * Export results to JSON
     */
    exportResults(filename = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = filename || `job-scraping-results-${timestamp}.json`;
        
        const exportData = {
            summary: this.getSummary(),
            results: this.results,
            timestamp: new Date().toISOString()
        };

        require('fs').writeFileSync(file, JSON.stringify(exportData, null, 2));
        console.log(`💾 Results exported to: ${file}`);
        return file;
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Example usage
async function main() {
    const scraper = new PostcodeJobScraper();
    
    try {
        // Test with 5 postal codes, looking for training positions (angebotsart=4)
        const results = await scraper.processPostalCodes(5, {
            size: 50,          // Get up to 50 jobs per postal code
            jobType: 4,        // 4 = Ausbildung/Training, 1 = Jobs
            radius: 0          // Exact postal code match
        });
        
        // Print summary
        console.log('\n📋 SUMMARY REPORT:');
        console.log('==================');
        const summary = scraper.getSummary();
        console.log(`Processed postal codes: ${summary.processedPostcodes}`);
        console.log(`Total jobs retrieved: ${summary.totalJobsRetrieved}`);
        console.log(`Total jobs available: ${summary.totalJobsAvailable}`);
        console.log(`Average jobs per postal code: ${summary.averageJobsPerPostcode}`);
        
        console.log('\n🏆 Top 5 postal codes by job count:');
        summary.topPostcodes.forEach((pc, i) => {
            console.log(`  ${i+1}. ${pc.postalCode} (${pc.city}): ${pc.totalJobs} jobs available, ${pc.retrieved} retrieved`);
        });
        
        // Export results
        scraper.exportResults();
        
    } catch (error) {
        console.error('❌ Script failed:', error.message);
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = PostcodeJobScraper;