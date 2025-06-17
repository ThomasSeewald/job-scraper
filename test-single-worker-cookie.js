const WorkerWithBatch = require('./src/worker-with-batch');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

async function testSingleWorker() {
    try {
        // Get a test domain
        const result = await pool.query(`
            SELECT id, domain, base_domain, frequency
            FROM job_scrp_domain_analysis 
            WHERE domain IS NOT NULL 
            AND domain <> ''
            AND (email_extraction_attempted IS NULL OR email_extraction_attempted = false)
            ORDER BY frequency DESC
            LIMIT 1
        `);
        
        if (result.rows.length === 0) {
            console.log('No unprocessed domains found');
            return;
        }
        
        const testDomain = result.rows[0];
        console.log(`Testing with domain: ${testDomain.domain}`);
        
        // Create worker with single domain
        const worker = new WorkerWithBatch(1, [testDomain], {
            headless: false // Visible for testing
        });
        
        // Run the worker
        const results = await worker.run();
        console.log('\nResults:', results);
        
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the test
testSingleWorker().catch(console.error);