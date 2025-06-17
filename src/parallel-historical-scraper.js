const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Parallel Historical Employer Scraper Coordinator
 * 
 * Manages 5 independent scraper processes, each with:
 * - Separate browser sessions (no shared cookies)
 * - Independent CAPTCHA cycles (1 CAPTCHA → 19 free pages each)
 * - Database coordination to avoid duplicates
 */
class ParallelHistoricalScraper {
    constructor() {
        this.processCount = 2; // Changed from 5 to 2 processes
        this.processes = [];
        this.batchSize = 12500; // Each process handles 12500 employers (25000/2)
        this.totalEmployers = 25000; // Total 25,000 newest employers
        this.processInterval = 10000; // 10 seconds between process starts
        this.isRunning = false;
        
        // Progress tracking
        this.processStats = new Array(2).fill(null).map((_, i) => ({
            processId: i + 1,
            processed: 0,
            successful: 0,
            emailsFound: 0,
            websitesFound: 0,
            remaining: 12500,
            status: 'ready',
            restartCount: 0,
            maxRestarts: 3
        }));
        
        // Logging
        this.logFile = path.join(__dirname, '../logs/parallel-historical-scraper.log');
        this.ensureLogDirectory();
    }

    /**
     * Ensure logs directory exists
     */
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Log message with timestamp
     */
    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        
        try {
            fs.appendFileSync(this.logFile, logMessage + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    /**
     * Prepare 25,000 newest employers and split into 5 batches
     */
    async prepareEmployerBatches() {
        const { Pool } = require('pg');
        const config = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../config/database.json'), 'utf8'));
        const pool = new Pool(config.production);
        
        this.log('📊 Preparing 25,000 newest employers for parallel processing...');
        
        const query = `
            WITH newest_employers AS (
                SELECT 
                    e.id,
                    e.name,
                    e.normalized_name,
                    j.refnr,
                    j.titel,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.aktuelleveroeffentlichungsdatum,
                    ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY j.aktuelleveroeffentlichungsdatum DESC) as rn
                FROM job_scrp_employers e
                INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
                WHERE (e.email_extraction_attempted = false OR e.email_extraction_attempted IS NULL)
                    AND (e.contact_emails IS NULL OR e.contact_emails = '')
                    AND (e.website IS NULL OR e.website = '')
                    AND (j.externeurl IS NULL OR j.externeurl = '')
                    AND j.refnr IS NOT NULL
                    AND j.is_active = true
            )
            SELECT 
                id,
                name,
                normalized_name,
                refnr,
                titel,
                arbeitsort_ort,
                arbeitsort_plz,
                aktuelleveroeffentlichungsdatum,
                ROW_NUMBER() OVER (ORDER BY aktuelleveroeffentlichungsdatum DESC) as batch_order
            FROM newest_employers 
            WHERE rn = 1
            ORDER BY aktuelleveroeffentlichungsdatum DESC
            LIMIT 25000
        `;
        
        const client = await pool.connect();
        try {
            const result = await client.query(query);
            const employers = result.rows;
            
            this.log(`✅ Found ${employers.length} newest employers for processing`);
            
            // Split into 2 batches
            const batches = [];
            for (let i = 0; i < 2; i++) {
                const start = i * 12500;
                const end = Math.min(start + 12500, employers.length);
                const batch = employers.slice(start, end);
                
                // Save batch to temporary file
                const batchFile = require('path').join(__dirname, `../temp_batch_${i + 1}.json`);
                require('fs').writeFileSync(batchFile, JSON.stringify(batch, null, 2));
                
                batches.push({
                    processId: i + 1,
                    batchFile: batchFile,
                    employerCount: batch.length,
                    dateRange: {
                        newest: batch[0]?.aktuelleveroeffentlichungsdatum,
                        oldest: batch[batch.length - 1]?.aktuelleveroeffentlichungsdatum
                    }
                });
                
                this.log(`📁 Batch ${i + 1}: ${batch.length} employers (${batch[0]?.aktuelleveroeffentlichungsdatum} to ${batch[batch.length - 1]?.aktuelleveroeffentlichungsdatum})`);
            }
            
            return batches;
            
        } finally {
            client.release();
            await pool.end();
        }
    }

    /**
     * Start all 5 parallel processes
     */
    async startParallelProcesses() {
        if (this.isRunning) {
            this.log('⚠️ Parallel processes already running');
            return;
        }

        this.isRunning = true;
        this.log('🚀 Starting 2 parallel historical employer scraper processes');
        this.log(`📊 Total: ${this.totalEmployers} employers split into 2 batches of ${this.batchSize} each`);
        this.log('🔒 Each process has independent browser session and CAPTCHA cycle');

        // Prepare employer batches
        const batches = await this.prepareEmployerBatches();
        
        // Start processes with staggered delays
        for (let i = 0; i < this.processCount; i++) {
            const batch = batches[i];
            
            // Stagger process starts to avoid database conflicts
            if (i > 0) {
                this.log(`⏳ Waiting ${this.processInterval/1000}s before starting process ${batch.processId}...`);
                await this.delay(this.processInterval);
            }
            
            this.startSingleProcess(batch);
        }

        this.log('✅ All 2 parallel processes started');
        this.monitorProcesses();
    }

    /**
     * Start a single scraper process
     */
    startSingleProcess(batch) {
        const processId = batch.processId;
        this.log(`🔄 Starting process ${processId}/2...`);
        this.log(`📁 Batch ${processId}: ${batch.employerCount} employers (${batch.dateRange.newest} to ${batch.dateRange.oldest})`);

        const args = [
            path.join(__dirname, 'batch-employer-scraper.js'),
            batch.batchFile,
            // Remove --headless to make browsers visible for verification
            '--process-id', processId.toString()
        ];

        const child = spawn('node', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                HEADLESS_MODE: process.env.HEADLESS_MODE || 'true', // Use env variable or default to true
                PROCESS_ID: processId.toString(),
                PARALLEL_MODE: 'true'
            }
        });

        // Update process status
        this.processStats[processId - 1].status = 'running';

        child.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output) {
                this.log(`[P${processId}] ${output}`);
                this.parseProcessOutput(processId, output);
            }
        });

        child.stderr.on('data', (data) => {
            const error = data.toString().trim();
            if (error) {
                this.log(`[P${processId}] ERROR: ${error}`);
            }
        });

        child.on('close', (code) => {
            this.log(`[P${processId}] Process exited with code ${code}`);
            const stats = this.processStats[processId - 1];
            
            if (code === 0) {
                stats.status = 'completed';
                this.processes[processId - 1] = null;
                
                // Clean up batch file
                try {
                    fs.unlinkSync(batch.batchFile);
                    this.log(`[P${processId}] Cleaned up batch file: ${batch.batchFile}`);
                } catch (error) {
                    this.log(`[P${processId}] Warning: Could not clean up batch file: ${error.message}`);
                }
            } else if (code !== 0 && stats.restartCount < stats.maxRestarts) {
                // Process failed but can be restarted
                stats.status = 'restarting';
                stats.restartCount++;
                
                this.log(`[P${processId}] Process failed with code ${code}, attempting restart ${stats.restartCount}/${stats.maxRestarts}`);
                
                // Don't clean up batch file - we'll reuse it
                this.processes[processId - 1] = null;
                
                // Schedule restart after delay (exponential backoff)
                const delay = Math.min(30000, 5000 * Math.pow(2, stats.restartCount - 1));
                this.log(`[P${processId}] Restarting in ${delay}ms...`);
                
                setTimeout(() => {
                    if (this.isRunning) {
                        this.startProcess(processId, batch);
                    }
                }, delay);
                
                return; // Don't check for all processes finished yet
            } else {
                // Process failed and exceeded restart attempts
                stats.status = 'failed';
                this.processes[processId - 1] = null;
                
                this.log(`[P${processId}] Process failed permanently after ${stats.restartCount} restart attempts`);
                
                // Clean up batch file
                try {
                    fs.unlinkSync(batch.batchFile);
                    this.log(`[P${processId}] Cleaned up batch file: ${batch.batchFile}`);
                } catch (error) {
                    this.log(`[P${processId}] Warning: Could not clean up batch file: ${error.message}`);
                }
            }
            
            // Check if all processes finished
            if (this.processes.every(p => p === null)) {
                this.log('🎉 All parallel processes completed');
                this.logFinalStats();
                this.isRunning = false;
            }
        });

        child.on('error', (error) => {
            this.log(`[P${processId}] Process error: ${error.message}`);
            this.processStats[processId - 1].status = 'error';
        });

        this.processes[processId - 1] = child;
        this.log(`✅ Process ${processId} started (PID: ${child.pid})`);
    }

    /**
     * Parse process output for progress tracking
     */
    parseProcessOutput(processId, output) {
        const stats = this.processStats[processId - 1];
        
        // Parse progress messages
        if (output.includes('Processed:')) {
            const match = output.match(/Processed:\s*(\d+)/);
            if (match) {
                stats.processed = parseInt(match[1]);
                stats.remaining = 12500 - stats.processed;
            }
        }
        
        if (output.includes('Successful:')) {
            const match = output.match(/Successful:\s*(\d+)/);
            if (match) {
                stats.successful = parseInt(match[1]);
            }
        }
        
        if (output.includes('Emails found:')) {
            const match = output.match(/Emails found:\s*(\d+)/);
            if (match) {
                stats.emailsFound = parseInt(match[1]);
            }
        }
        
        if (output.includes('Websites found:')) {
            const match = output.match(/Websites found:\s*(\d+)/);
            if (match) {
                stats.websitesFound = parseInt(match[1]);
            }
        }
    }

    /**
     * Monitor running processes
     */
    async monitorProcesses() {
        this.log('👀 Starting process monitor...');
        
        const monitor = setInterval(() => {
            const runningCount = this.processes.filter(p => p !== null).length;
            
            if (runningCount === 0) {
                this.log('✅ All processes completed - stopping monitor');
                clearInterval(monitor);
                this.isRunning = false;
                return;
            }
            
            this.log(`📊 Monitor: ${runningCount}/2 processes still running`);
            this.logProgressStats();
        }, 60000); // Check every 60 seconds
    }

    /**
     * Log progress statistics
     */
    logProgressStats() {
        this.log('📈 Progress Summary:');
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalEmails = 0;
        let totalWebsites = 0;
        
        for (const stats of this.processStats) {
            this.log(`   Process ${stats.processId}: ${stats.processed}/12500 processed, ${stats.successful} successful, ${stats.emailsFound} emails, ${stats.websitesFound} websites, ${stats.remaining} remaining (${stats.status})`);
            totalProcessed += stats.processed;
            totalSuccessful += stats.successful;
            totalEmails += stats.emailsFound;
            totalWebsites += stats.websitesFound;
        }
        
        this.log(`📊 TOTAL: ${totalProcessed}/25000 processed, ${totalSuccessful} successful, ${totalEmails} emails, ${totalWebsites} websites`);
        
        if (totalProcessed > 0) {
            const successRate = (totalSuccessful / totalProcessed * 100).toFixed(1);
            const emailRate = (totalEmails / totalSuccessful * 100).toFixed(1);
            this.log(`📊 Success Rate: ${successRate}%, Email Discovery Rate: ${emailRate}%`);
        }
    }

    /**
     * Log final statistics
     */
    logFinalStats() {
        this.log('🎉 FINAL STATISTICS:');
        this.logProgressStats();
        
        const completedProcesses = this.processStats.filter(s => s.status === 'completed').length;
        const failedProcesses = this.processStats.filter(s => s.status === 'failed').length;
        
        this.log(`✅ Completed processes: ${completedProcesses}/2`);
        if (failedProcesses > 0) {
            this.log(`❌ Failed processes: ${failedProcesses}/2`);
        }
        
        this.log('📁 All batch files cleaned up');
        this.log('🎯 Ready to restart manually with remaining employers');
    }

    /**
     * Stop all processes
     */
    stopAllProcesses() {
        this.log('🛑 Stopping all parallel processes...');
        
        this.processes.forEach((child, index) => {
            if (child && !child.killed) {
                this.log(`🔴 Stopping process ${index + 1}...`);
                child.kill('SIGTERM');
            }
        });

        this.processes = [];
        this.isRunning = false;
        this.log('🛑 All processes stopped');
    }

    /**
     * Get status of all processes
     */
    getStatus() {
        const runningCount = this.processes.filter(p => p !== null && !p.killed).length;
        return {
            isRunning: this.isRunning,
            totalProcesses: this.processCount,
            runningProcesses: runningCount,
            batchSize: this.batchSize
        };
    }

    /**
     * Utility delay function
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    const scraper = new ParallelHistoricalScraper();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'start':
            await scraper.startParallelProcesses();
            break;
            
        case 'stop':
            scraper.stopAllProcesses();
            break;
            
        case 'status':
            const status = scraper.getStatus();
            console.log('📊 Parallel Scraper Status:');
            console.log(`   Running: ${status.isRunning}`);
            console.log(`   Processes: ${status.runningProcesses}/${status.totalProcesses}`);
            console.log(`   Batch size: ${status.batchSize} employers per process`);
            break;
            
        default:
            console.log('Usage:');
            console.log('  node parallel-historical-scraper.js start   # Start 2 parallel processes');
            console.log('  node parallel-historical-scraper.js stop    # Stop all processes');
            console.log('  node parallel-historical-scraper.js status  # Check status');
            break;
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, stopping all processes...');
    const scraper = new ParallelHistoricalScraper();
    scraper.stopAllProcesses();
    process.exit(0);
});

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = ParallelHistoricalScraper;