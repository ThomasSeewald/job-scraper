const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class BatchAllocator {
    static async allocateDomainBatches(numWorkers, domainsPerWorker) {
        console.log(`Allocating ${domainsPerWorker} domains to each of ${numWorkers} workers...`);
        
        // Get all unprocessed domains in one query
        const query = `
            SELECT 
                da.id,
                da.domain,
                da.base_domain,
                da.frequency
            FROM job_scrp_domain_analysis da
            WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
            AND da.domain IS NOT NULL 
            AND da.domain <> ''
            ORDER BY da.frequency DESC, da.id
            LIMIT $1
        `;
        
        const totalDomainsNeeded = numWorkers * domainsPerWorker;
        const result = await pool.query(query, [totalDomainsNeeded]);
        
        console.log(`Found ${result.rows.length} domains to allocate`);
        
        // Divide domains into separate batches for each worker
        const batches = [];
        for (let i = 0; i < numWorkers; i++) {
            const startIndex = i * domainsPerWorker;
            const endIndex = startIndex + domainsPerWorker;
            const workerDomains = result.rows.slice(startIndex, endIndex);
            
            if (workerDomains.length > 0) {
                batches.push({
                    workerId: i + 1,
                    domains: workerDomains,
                    domainCount: workerDomains.length
                });
                
                console.log(`Worker ${i + 1}: ${workerDomains.length} domains (${workerDomains[0]?.domain} to ${workerDomains[workerDomains.length - 1]?.domain})`);
            }
        }
        
        return batches;
    }
    
    static async getRemainingCount() {
        const result = await pool.query(`
            SELECT COUNT(*) as remaining
            FROM job_scrp_domain_analysis da
            WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
            AND da.domain IS NOT NULL 
            AND da.domain <> ''
        `);
        return parseInt(result.rows[0].remaining);
    }
}

module.exports = BatchAllocator;