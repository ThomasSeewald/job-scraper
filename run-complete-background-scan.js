const IntelligentJobScraper = require('./src/intelligent-api-scraper');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

/**
 * Complete Background Scanning Service
 * Scans ALL postal codes progressively over 14-day cycles
 * Each run processes a batch of PLZ codes with 14-day lookback
 */
class CompleteBackgroundScanService {
    constructor() {
        this.isRunning = false;
        this.currentScanId = null;
        this.logFile = path.join(__dirname, 'background-scan.log');
        this.statusFile = path.join(__dirname, 'scan-status.json');
        this.progressFile = path.join(__dirname, 'plz-progress.json');
        this.batchSize = 200; // Process 200 PLZ per run (4 hours = 6 runs/day = 1200 PLZ/day)
        this.cycleDays = 14; // Restart cycle every 14 days
    }
    
    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        console.log(message);
        fs.appendFileSync(this.logFile, logEntry);
    }
    
    updateStatus(status) {
        const statusData = {
            isRunning: this.isRunning,
            currentScanId: this.currentScanId,
            lastUpdate: new Date().toISOString(),
            status: status,
            nextScan: this.getNextScanTime(),
            batchSize: this.batchSize,
            cycleDays: this.cycleDays
        };
        fs.writeFileSync(this.statusFile, JSON.stringify(statusData, null, 2));
    }
    
    getNextScanTime() {
        const now = new Date();
        const nextScan = new Date(now.getTime() + (4 * 60 * 60 * 1000)); // 4 hours from now
        return nextScan.toISOString();
    }

    /**
     * Get or initialize PLZ progress tracking
     */
    getProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                
                // Check if cycle should restart (14 days)
                const lastStart = new Date(progress.cycleStartDate);
                const daysSinceStart = (Date.now() - lastStart.getTime()) / (1000 * 60 * 60 * 24);
                
                if (daysSinceStart >= this.cycleDays) {
                    this.log(`🔄 14-day cycle completed (${daysSinceStart.toFixed(1)} days), restarting...`);
                    return this.initializeProgress();
                }
                
                return progress;
            }
        } catch (error) {
            this.log(`⚠️ Error reading progress file: ${error.message}`);
        }
        
        return this.initializeProgress();
    }
    
    /**
     * Initialize fresh PLZ progress
     */
    initializeProgress() {
        const progress = {
            cycleStartDate: new Date().toISOString(),
            currentIndex: 0,
            totalPlzCount: 0,
            completedPlz: 0,
            cycleNumber: 1,
            lastBatchDate: null
        };
        
        fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
        this.log('🆕 Initialized new 14-day PLZ scanning cycle');
        return progress;
    }
    
    /**
     * Update progress after batch completion
     */
    updateProgress(progress, processedCount) {
        progress.currentIndex += processedCount;
        progress.completedPlz += processedCount;
        progress.lastBatchDate = new Date().toISOString();
        
        // If we've completed all PLZ, restart cycle
        if (progress.currentIndex >= progress.totalPlzCount) {
            this.log('✅ All PLZ completed for this cycle');
            progress = this.initializeProgress();
            progress.cycleNumber++;
        }
        
        fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
        return progress;
    }

    /**
     * Get next batch of postal codes to process
     */
    async getNextPlzBatch() {
        const client = await pool.connect();
        
        try {
            // Get total count first
            const countQuery = `
                SELECT COUNT(*) as total
                FROM our_sql_postal_code 
                WHERE postal_code IS NOT NULL 
                AND LENGTH(postal_code) = 5
            `;
            const countResult = await client.query(countQuery);
            const totalCount = parseInt(countResult.rows[0].total);
            
            // Get current progress
            const progress = this.getProgress();
            progress.totalPlzCount = totalCount;
            
            // Get next batch
            const query = `
                SELECT 
                    postal_code, 
                    city,
                    latitude,
                    longitude
                FROM our_sql_postal_code 
                WHERE postal_code IS NOT NULL 
                AND LENGTH(postal_code) = 5
                ORDER BY postal_code ASC
                OFFSET $1 LIMIT $2
            `;
            
            const result = await client.query(query, [progress.currentIndex, this.batchSize]);
            
            this.log(`📍 Progress: ${progress.currentIndex}/${totalCount} PLZ (${((progress.currentIndex/totalCount)*100).toFixed(1)}%)`);
            this.log(`📋 Next batch: ${result.rows.length} postal codes starting from index ${progress.currentIndex}`);
            
            return {
                postalCodes: result.rows,
                progress: progress,
                totalCount: totalCount
            };
            
        } finally {
            client.release();
        }
    }

    async runSingleScanCycle() {
        if (this.isRunning) {
            this.log('⚠️ Scan already running, skipping...');
            return;
        }
        
        this.isRunning = true;
        this.currentScanId = `complete-scan-${Date.now()}`;
        this.log(`🚀 Starting complete background scan cycle: ${this.currentScanId}`);
        this.log(`📅 14-day cycle with ${this.batchSize} PLZ per batch`);
        this.updateStatus('running');
        
        try {
            // Get next PLZ batch
            const batchInfo = await this.getNextPlzBatch();
            const { postalCodes, progress, totalCount } = batchInfo;
            
            if (postalCodes.length === 0) {
                this.log('📍 No more PLZ to process, cycle will restart next run');
                this.updateStatus('cycle-completed');
                return;
            }
            
            // Jobs scan (14-day lookback)
            this.log('📋 Starting JOBS complete scan...');
            const jobScraper = new IntelligentJobScraper('job', 14);
            const jobResults = await this.scanPostalCodes(jobScraper, postalCodes);
            
            this.log(`📊 JOBS completed: ${jobResults.newPositions} new, ${jobResults.skippedDuplicates} duplicates`);
            
            // Short break
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Ausbildung scan (14-day lookback)
            this.log('🎓 Starting AUSBILDUNG complete scan...');
            const ausbildungScraper = new IntelligentJobScraper('ausbildung', 14);
            const ausbildungResults = await this.scanPostalCodes(ausbildungScraper, postalCodes);
            
            this.log(`📊 AUSBILDUNG completed: ${ausbildungResults.newPositions} new, ${ausbildungResults.skippedDuplicates} duplicates`);
            
            const totalNew = jobResults.newPositions + ausbildungResults.newPositions;
            const totalProcessed = jobResults.totalJobsFound + ausbildungResults.totalJobsFound;
            
            // Update progress
            const updatedProgress = this.updateProgress(progress, postalCodes.length);
            
            this.log(`✅ Batch completed: ${totalNew} new positions from ${totalProcessed} total jobs`);
            this.log(`📊 Cycle progress: ${updatedProgress.completedPlz}/${totalCount} PLZ completed`);
            
            // Clean up inactive jobs periodically (every 10 batches)
            if (updatedProgress.completedPlz % 2000 === 0) {
                await this.cleanupInactiveJobs();
            }
            
            this.updateStatus('completed');
            
        } catch (error) {
            this.log(`❌ Scan cycle failed: ${error.message}`);
            this.updateStatus('error');
        } finally {
            this.isRunning = false;
            this.currentScanId = null;
        }
    }
    
    /**
     * Scan a batch of postal codes
     */
    async scanPostalCodes(scraper, postalCodes) {
        let results = {
            newPositions: 0,
            skippedDuplicates: 0,
            totalJobsFound: 0
        };
        
        for (const postcodeData of postalCodes) {
            try {
                const postcodeResults = await scraper.queryJobsForPostcode(postcodeData.postal_code);
                
                results.newPositions += postcodeResults.newPositions || 0;
                results.skippedDuplicates += postcodeResults.skippedDuplicates || 0;
                results.totalJobsFound += postcodeResults.totalJobsFound || 0;
                
                // Small delay between postal codes
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                this.log(`❌ Error scanning PLZ ${postcodeData.postal_code}: ${error.message}`);
            }
        }
        
        return results;
    }
    
    /**
     * Clean up jobs that haven't been seen in API for 7+ days
     */
    async cleanupInactiveJobs() {
        this.log('🧹 Cleaning up inactive jobs...');
        
        const client = await pool.connect();
        try {
            // Mark jobs as inactive if not seen for 7 days
            const inactiveResult = await client.query(`
                UPDATE job_scrp_arbeitsagentur_jobs_v2
                SET 
                    is_active = false,
                    marked_inactive_date = CURRENT_TIMESTAMP,
                    last_updated = CURRENT_TIMESTAMP
                WHERE 
                    is_active = true 
                    AND last_seen_in_api < CURRENT_TIMESTAMP - INTERVAL '7 days'
                RETURNING refnr
            `);
            
            const inactiveCount = inactiveResult.rows.length;
            
            // Mark jobs as old if published more than 7 days ago
            const oldResult = await client.query(`
                UPDATE job_scrp_arbeitsagentur_jobs_v2
                SET 
                    old = true,
                    last_updated = CURRENT_TIMESTAMP
                WHERE 
                    old = false 
                    AND aktuelleVeroeffentlichungsdatum < CURRENT_TIMESTAMP - INTERVAL '7 days'
                RETURNING refnr
            `);
            
            const oldCount = oldResult.rows.length;
            
            this.log(`📊 Cleanup complete: ${inactiveCount} jobs marked inactive, ${oldCount} jobs marked as old`);
            
        } catch (error) {
            this.log(`❌ Error cleaning up inactive jobs: ${error.message}`);
        } finally {
            client.release();
        }
    }
    
    async startContinuousScanning() {
        this.log('🔄 Starting complete background scanning service...');
        this.log('📅 Will scan all PLZ every 4 hours with 14-day cycles');
        
        // Run initial scan
        await this.runSingleScanCycle();
        
        // Schedule regular scans every 4 hours
        setInterval(async () => {
            await this.runSingleScanCycle();
        }, 4 * 60 * 60 * 1000); // 4 hours
        
        this.log('✅ Complete background scanning service is now running...');
        this.log('💡 Check scan-status.json for current status');
        this.log('📋 Check background-scan.log for detailed logs');
        this.log('📊 Check plz-progress.json for cycle progress');
    }
    
    async runOnce() {
        this.log('🎯 Running single complete background scan cycle...');
        await this.runSingleScanCycle();
        this.log('✅ Single scan cycle completed');
        process.exit(0);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const service = new CompleteBackgroundScanService();

if (args.includes('--once')) {
    // Run once and exit
    service.runOnce();
} else if (args.includes('--continuous')) {
    // Run continuously
    service.startContinuousScanning();
} else {
    console.log('🔧 Complete Background Scan Service');
    console.log('Usage:');
    console.log('  node run-complete-background-scan.js --once        # Run single batch');
    console.log('  node run-complete-background-scan.js --continuous  # Run continuous scanning');
    console.log('');
    console.log('Features:');
    console.log('  📍 Scans ALL postal codes progressively');
    console.log('  📅 14-day lookback period');
    console.log('  🔄 Restarts cycle every 14 days');
    console.log('  📊 200 PLZ per batch (4-hour intervals)');
    console.log('');
    console.log('Files created:');
    console.log('  background-scan.log    # Detailed scan logs');
    console.log('  scan-status.json       # Current scan status');
    console.log('  plz-progress.json      # 14-day cycle progress');
}