const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class ParallelKeywordScraper {
    constructor(options = {}) {
        this.numWorkers = options.numWorkers || 5;
        this.batchSize = options.batchSize || 10; // Each worker processes 10 domains
        this.workers = [];
        this.startTime = Date.now();
        this.processedCount = 0;
        this.emailsFound = 0;
    }

    async getRemainingCount() {
        const result = await pool.query(`
            SELECT COUNT(*) as remaining
            FROM job_scrp_domain_analysis da
            WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
            AND da.domain IS NOT NULL 
            AND da.domain <> ''
        `);
        return parseInt(result.rows[0].remaining);
    }

    spawnWorker(workerId) {
        return new Promise((resolve, reject) => {
            console.log(`[Worker ${workerId}] Starting with batch size ${this.batchSize}`);
            
            const scriptPath = path.join(__dirname, 'keyword-domain-scraper-with-lock.js');
            const worker = spawn('node', [scriptPath, this.batchSize.toString()], {
                env: { 
                    ...process.env, 
                    HEADLESS_MODE: 'true',
                    WORKER_ID: workerId 
                }
            });

            let output = '';
            let errorOutput = '';

            worker.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                
                // Parse progress from output
                if (text.includes('Completed')) {
                    const match = text.match(/Completed ([^:]+): (\d+) emails found/);
                    if (match) {
                        console.log(`[Worker ${workerId}] Processed ${match[1]} - ${match[2]} emails`);
                        this.processedCount++;
                        this.emailsFound += parseInt(match[2]);
                    }
                }
            });

            worker.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            worker.on('close', (code) => {
                if (code === 0) {
                    // Extract summary from output
                    const summaryMatch = output.match(/Domains processed: (\d+)/);
                    const emailsMatch = output.match(/Total emails found: (\d+)/);
                    
                    const domainsProcessed = summaryMatch ? parseInt(summaryMatch[1]) : 0;
                    const totalEmails = emailsMatch ? parseInt(emailsMatch[1]) : 0;
                    
                    console.log(`[Worker ${workerId}] Completed: ${domainsProcessed} domains, ${totalEmails} emails`);
                    resolve({ workerId, domainsProcessed, totalEmails });
                } else {
                    console.error(`[Worker ${workerId}] Failed with code ${code}`);
                    if (errorOutput) {
                        console.error(`[Worker ${workerId}] Error:`, errorOutput);
                    }
                    reject(new Error(`Worker ${workerId} failed`));
                }
            });

            this.workers.push({ id: workerId, process: worker });
        });
    }

    async runParallel() {
        console.log('=== Starting Parallel Keyword Domain Scraping ===');
        console.log(`Workers: ${this.numWorkers}, Batch size per worker: ${this.batchSize}`);
        
        const initialCount = await this.getRemainingCount();
        console.log(`Domains to process: ${initialCount}`);
        
        if (initialCount === 0) {
            console.log('No domains left to process!');
            return;
        }

        // Calculate how many rounds we need
        const domainsPerRound = this.numWorkers * this.batchSize;
        const rounds = Math.ceil(initialCount / domainsPerRound);
        console.log(`Estimated rounds: ${rounds}`);

        let round = 0;
        let totalProcessed = 0;
        let totalEmailsFound = 0;

        while (true) {
            round++;
            const remaining = await this.getRemainingCount();
            
            if (remaining === 0) {
                console.log('\n✅ All domains processed!');
                break;
            }

            console.log(`\n--- Round ${round} ---`);
            console.log(`Remaining domains: ${remaining}`);

            // Spawn workers for this round
            const workerPromises = [];
            const workersToSpawn = Math.min(this.numWorkers, Math.ceil(remaining / this.batchSize));

            for (let i = 0; i < workersToSpawn; i++) {
                workerPromises.push(this.spawnWorker(i + 1));
            }

            try {
                // Wait for all workers to complete
                const results = await Promise.allSettled(workerPromises);
                
                // Count successful completions
                let roundProcessed = 0;
                let roundEmails = 0;
                
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        roundProcessed += result.value.domainsProcessed;
                        roundEmails += result.value.totalEmails;
                    } else {
                        console.error(`Worker ${index + 1} failed:`, result.reason);
                    }
                });

                totalProcessed += roundProcessed;
                totalEmailsFound += roundEmails;

                console.log(`Round ${round} complete: ${roundProcessed} domains, ${roundEmails} emails`);

                // Show progress
                const elapsed = (Date.now() - this.startTime) / 1000 / 60; // minutes
                const rate = totalProcessed / elapsed;
                const remainingTime = remaining > 0 ? (remaining / rate).toFixed(1) : 0;

                console.log(`\n📊 Progress Statistics:`);
                console.log(`Total processed: ${totalProcessed} domains`);
                console.log(`Total emails found: ${totalEmailsFound}`);
                console.log(`Processing rate: ${rate.toFixed(1)} domains/minute`);
                console.log(`Estimated time remaining: ${remainingTime} minutes`);

            } catch (error) {
                console.error('Error in round:', error);
            }

            // Small delay between rounds to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Final summary
        const totalTime = (Date.now() - this.startTime) / 1000 / 60;
        console.log('\n=== Final Summary ===');
        console.log(`Total domains processed: ${totalProcessed}`);
        console.log(`Total emails found: ${totalEmailsFound}`);
        console.log(`Average emails per domain: ${(totalEmailsFound / totalProcessed).toFixed(2)}`);
        console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
        console.log(`Overall rate: ${(totalProcessed / totalTime).toFixed(1)} domains/minute`);
        
        await pool.end();
    }

    // Cleanup method to kill any remaining workers
    cleanup() {
        this.workers.forEach(worker => {
            if (worker.process && !worker.process.killed) {
                worker.process.kill();
            }
        });
    }
}

// CLI usage
if (require.main === module) {
    const numWorkers = parseInt(process.argv[2]) || 5;
    const batchSize = parseInt(process.argv[3]) || 10;
    
    const manager = new ParallelKeywordScraper({ numWorkers, batchSize });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down workers...');
        manager.cleanup();
        process.exit(0);
    });
    
    manager.runParallel().catch(console.error).finally(() => {
        manager.cleanup();
    });
}

module.exports = ParallelKeywordScraper;