const { spawn } = require('child_process');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

async function getDetachedFrameEmployers() {
    const client = await pool.connect();
    try {
        // Find employers with detached Frame errors
        const query = `
            SELECT 
                e.id,
                e.name,
                e.normalized_name,
                j.refnr,
                j.titel,
                j.arbeitsort_ort,
                j.arbeitsort_plz,
                j.aktuelleveroeffentlichungsdatum
            FROM job_scrp_employers e
            INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
            WHERE e.notes LIKE '%detached Frame%'
                AND e.email_extraction_attempted = true
                AND j.refnr IS NOT NULL
                AND j.is_active = true
                AND (j.externeurl IS NULL OR j.externeurl = '')
            ORDER BY j.aktuelleveroeffentlichungsdatum DESC
            LIMIT 15000
        `;
        
        const result = await client.query(query);
        console.log(`🔍 Found ${result.rows.length} employers with detached Frame errors`);
        
        return result.rows;
        
    } finally {
        client.release();
    }
}

async function createBatchFiles(employers) {
    console.log('📁 Creating batch files for retry...');
    
    // Split into 3 batches
    const batchSize = Math.ceil(employers.length / 3);
    const batches = [];
    
    for (let i = 0; i < 3; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, employers.length);
        const batch = employers.slice(start, end);
        
        if (batch.length > 0) {
            // Save batch to temporary file
            const batchFile = path.join(__dirname, `temp_retry_batch_${i + 1}.json`);
            fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2));
            
            batches.push({
                processId: i + 1,
                batchFile: batchFile,
                employerCount: batch.length
            });
            
            console.log(`📁 Batch ${i + 1}: ${batch.length} employers to retry`);
        }
    }
    
    return batches;
}

async function startRetryProcesses(batches) {
    console.log('🚀 Starting retry processes for detached Frame employers...');
    
    const processes = [];
    const processDelay = 5000; // 5 seconds between each process start
    
    for (const batch of batches) {
        console.log(`\n🔄 Starting process ${batch.processId}/${batches.length}...`);
        
        const args = [
            path.join(__dirname, 'src/batch-employer-scraper.js'),
            batch.batchFile,
            '--process-id', batch.processId.toString()
        ];

        const child = spawn('node', args, {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                HEADLESS_MODE: 'false',  // Visible browser windows
                PROCESS_ID: batch.processId.toString(),
                PARALLEL_MODE: 'true'
            }
        });

        child.unref();
        processes.push(child);
        
        console.log(`✅ Process ${batch.processId} started (PID: ${child.pid})`);
        console.log(`📁 Retrying ${batch.employerCount} employers with detached Frame errors`);
        
        if (batch.processId < batches.length) {
            console.log(`⏳ Waiting ${processDelay/1000} seconds before starting next process...`);
            await new Promise(resolve => setTimeout(resolve, processDelay));
        }
    }
    
    console.log('\n✅ All retry processes started');
    console.log('📊 Monitor progress in: logs/parallel-historical-scraper.log');
    console.log('🖥️ Browser windows should be visible');
    console.log('🔄 These processes will retry employers that had browser crashes');
}

async function main() {
    try {
        // Get employers with detached Frame errors
        const employers = await getDetachedFrameEmployers();
        
        if (employers.length === 0) {
            console.log('✅ No employers with detached Frame errors found');
            await pool.end();
            return;
        }
        
        // Reset the attempted flag for these employers
        console.log('🔄 Resetting attempted flag for these employers...');
        const client = await pool.connect();
        try {
            const resetQuery = `
                UPDATE job_scrp_employers 
                SET email_extraction_attempted = false,
                    notes = REPLACE(notes, 'Error: Attempted to use detached Frame', 'Retrying after browser crash')
                WHERE notes LIKE '%detached Frame%'
            `;
            const resetResult = await client.query(resetQuery);
            console.log(`✅ Reset ${resetResult.rowCount} employers for retry`);
        } finally {
            client.release();
        }
        
        // Create batch files
        const batches = await createBatchFiles(employers);
        
        // Start retry processes
        await startRetryProcesses(batches);
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

// Run the retry process
main();