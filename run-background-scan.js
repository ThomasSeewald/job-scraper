const IntelligentJobScraper = require('./src/intelligent-api-scraper');
const fs = require('fs');
const path = require('path');

/**
 * Background scanning service for continuous data collection
 * Designed to run as a long-running process or scheduled job
 */
class BackgroundScanService {
    constructor() {
        this.isRunning = false;
        this.currentScanId = null;
        this.logFile = path.join(__dirname, 'background-scan.log');
        this.statusFile = path.join(__dirname, 'scan-status.json');
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
            nextScan: this.getNextScanTime()
        };
        fs.writeFileSync(this.statusFile, JSON.stringify(statusData, null, 2));
    }
    
    getNextScanTime() {
        const now = new Date();
        const nextScan = new Date(now.getTime() + (4 * 60 * 60 * 1000)); // 4 hours from now
        return nextScan.toISOString();
    }
    
    async runSingleScanCycle() {
        if (this.isRunning) {
            this.log('⚠️ Scan already running, skipping...');
            return;
        }
        
        this.isRunning = true;
        this.currentScanId = `scan-${Date.now()}`;
        this.log(`🚀 Starting background scan cycle: ${this.currentScanId}`);
        this.updateStatus('running');
        
        try {
            // Jobs scan (50 postal codes)
            this.log('📋 Starting JOBS background scan...');
            const jobScraper = new IntelligentJobScraper('job', 28);
            const jobResults = await jobScraper.runIntelligentScraping(50);
            
            this.log(`📊 JOBS completed: ${jobResults.newPositions} new, ${jobResults.skippedDuplicates} duplicates`);
            
            // Short break
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Ausbildung scan (50 postal codes)
            this.log('🎓 Starting AUSBILDUNG background scan...');
            const ausbildungScraper = new IntelligentJobScraper('ausbildung', 28);
            const ausbildungResults = await ausbildungScraper.runIntelligentScraping(50);
            
            this.log(`📊 AUSBILDUNG completed: ${ausbildungResults.newPositions} new, ${ausbildungResults.skippedDuplicates} duplicates`);
            
            const totalNew = jobResults.newPositions + ausbildungResults.newPositions;
            const totalProcessed = jobResults.totalJobsFound + ausbildungResults.totalJobsFound;
            
            this.log(`✅ Scan cycle completed: ${totalNew} new positions from ${totalProcessed} total jobs`);
            this.updateStatus('completed');
            
        } catch (error) {
            this.log(`❌ Scan cycle failed: ${error.message}`);
            this.updateStatus('error');
        } finally {
            this.isRunning = false;
            this.currentScanId = null;
        }
    }
    
    async startContinuousScanning() {
        this.log('🔄 Starting continuous background scanning service...');
        this.log('📅 Will scan every 4 hours with 28-day lookback');
        
        // Run initial scan
        await this.runSingleScanCycle();
        
        // Schedule regular scans every 4 hours
        setInterval(async () => {
            await this.runSingleScanCycle();
        }, 4 * 60 * 60 * 1000); // 4 hours
        
        this.log('✅ Background scanning service is now running...');
        this.log('💡 Check scan-status.json for current status');
        this.log('📋 Check background-scan.log for detailed logs');
    }
    
    async runOnce() {
        this.log('🎯 Running single background scan cycle...');
        await this.runSingleScanCycle();
        this.log('✅ Single scan cycle completed');
        process.exit(0);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const service = new BackgroundScanService();

if (args.includes('--once')) {
    // Run once and exit
    service.runOnce();
} else if (args.includes('--continuous')) {
    // Run continuously
    service.startContinuousScanning();
} else {
    console.log('🔧 Background Scan Service');
    console.log('Usage:');
    console.log('  node run-background-scan.js --once        # Run single scan cycle');
    console.log('  node run-background-scan.js --continuous  # Run continuous scanning');
    console.log('');
    console.log('Files created:');
    console.log('  background-scan.log  # Detailed scan logs');
    console.log('  scan-status.json     # Current scan status');
}