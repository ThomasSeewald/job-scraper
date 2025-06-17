const IntelligentJobScraper = require('./src/intelligent-api-scraper');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

/**
 * Daily Fresh Job Scanner
 * Scans ALL postal codes sequentially for jobs published in last 2 days
 * No prioritization - complete coverage approach
 */
class DailyFreshScanner {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.logFile = path.join(__dirname, 'daily-fresh.log');
        this.performanceFile = path.join(__dirname, 'plz-performance.json');
        this.stats = {
            totalPlzScanned: 0,
            jobsFound: 0,
            ausbildungFound: 0,
            newPositions: 0,
            duplicatesSkipped: 0,
            zeroResultPlz: 0,
            apiCalls: 0,
            startTime: new Date()
        };
        
        console.log('🆕 Daily Fresh Scanner initialized');
        console.log(`🆔 Session: ${this.sessionId}`);
        console.log('📅 Scanning jobs published in last 2 days');
    }
    
    generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `daily-fresh-${timestamp}`;
    }
    
    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        console.log(message);
        fs.appendFileSync(this.logFile, logEntry);
    }
    
    /**
     * Get ALL postal codes sequentially (no prioritization)
     */
    async getAllPostalCodes() {
        const client = await pool.connect();
        
        try {
            const query = `
                SELECT 
                    postal_code, 
                    city,
                    latitude,
                    longitude
                FROM our_sql_postal_code 
                WHERE postal_code IS NOT NULL 
                AND LENGTH(postal_code) = 5
                ORDER BY postal_code ASC  -- Sequential order
            `;
            
            const result = await client.query(query);
            this.log(`📋 Found ${result.rows.length} postal codes for sequential scanning`);
            return result.rows;
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Track PLZ performance for future optimization
     */
    async trackPlzPerformance(plz, city, jobResults, ausbildungResults) {
        let performance = {};
        
        // Load existing performance data
        try {
            if (fs.existsSync(this.performanceFile)) {
                performance = JSON.parse(fs.readFileSync(this.performanceFile, 'utf8'));
            }
        } catch (error) {
            // File doesn't exist or is corrupted, start fresh
        }
        
        // Initialize PLZ data if not exists
        if (!performance[plz]) {
            performance[plz] = {
                city: city,
                totalScans: 0,
                totalJobsFound: 0,
                totalAusbildungFound: 0,
                lastScan: null,
                zeroResultDays: 0,
                avgJobsPerScan: 0
            };
        }
        
        // Update performance data
        const plzData = performance[plz];
        plzData.totalScans++;
        plzData.totalJobsFound += (jobResults?.totalJobsFound || 0);
        plzData.totalAusbildungFound += (ausbildungResults?.totalJobsFound || 0);
        plzData.lastScan = new Date().toISOString();
        
        // Track zero result days
        if ((jobResults?.totalJobsFound || 0) === 0 && (ausbildungResults?.totalJobsFound || 0) === 0) {
            plzData.zeroResultDays++;
        } else {
            plzData.zeroResultDays = 0; // Reset if we found jobs
        }
        
        // Calculate average
        plzData.avgJobsPerScan = (plzData.totalJobsFound + plzData.totalAusbildungFound) / plzData.totalScans;
        
        // Save performance data
        fs.writeFileSync(this.performanceFile, JSON.stringify(performance, null, 2));
    }
    
    /**
     * Main scanning function - processes ALL PLZ sequentially
     */
    async runDailyFreshScan() {
        this.log('🚀 Starting Daily Fresh Scan (2 days, all PLZ sequential)');
        
        try {
            // Get all postal codes
            const postalCodes = await this.getAllPostalCodes();
            
            this.log(`📊 Processing ${postalCodes.length} postal codes sequentially`);
            this.log('🎯 Strategy: Complete coverage, no prioritization');
            
            for (const [index, postcodeData] of postalCodes.entries()) {
                await this.scanPostalCode(postcodeData, index + 1, postalCodes.length);
                
                // Small delay to be API-friendly
                if (index < postalCodes.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
                
                // Progress report every 100 PLZ
                if ((index + 1) % 100 === 0) {
                    this.printProgress();
                }
            }
            
            await this.printFinalStats();
            this.log('✅ Daily Fresh Scan completed successfully');
            
        } catch (error) {
            this.log(`❌ Daily Fresh Scan failed: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Scan a single postal code for both job types
     */
    async scanPostalCode(postcodeData, index, total) {
        const plz = postcodeData.postal_code;
        const city = postcodeData.city || 'Unknown';
        
        console.log(`\n[${index}/${total}] PLZ ${plz} (${city})`);
        
        try {
            // Scan Jobs (2 days)
            const jobScraper = new IntelligentJobScraper('job', 2);
            const jobResults = await this.scanSingleType(jobScraper, plz);
            
            // Small break between job types
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Scan Ausbildung (2 days)
            const ausbildungScraper = new IntelligentJobScraper('ausbildung', 2);
            const ausbildungResults = await this.scanSingleType(ausbildungScraper, plz);
            
            // Update statistics
            this.stats.totalPlzScanned++;
            this.stats.jobsFound += (jobResults?.totalJobsFound || 0);
            this.stats.ausbildungFound += (ausbildungResults?.totalJobsFound || 0);
            this.stats.newPositions += (jobResults?.newPositions || 0) + (ausbildungResults?.newPositions || 0);
            this.stats.duplicatesSkipped += (jobResults?.skippedDuplicates || 0) + (ausbildungResults?.skippedDuplicates || 0);
            this.stats.apiCalls += 2; // One call per job type
            
            // Track zero results
            if ((jobResults?.totalJobsFound || 0) === 0 && (ausbildungResults?.totalJobsFound || 0) === 0) {
                this.stats.zeroResultPlz++;
            }
            
            // Track performance for future optimization
            await this.trackPlzPerformance(plz, city, jobResults, ausbildungResults);
            
            const totalFound = (jobResults?.totalJobsFound || 0) + (ausbildungResults?.totalJobsFound || 0);
            const totalNew = (jobResults?.newPositions || 0) + (ausbildungResults?.newPositions || 0);
            
            if (totalFound > 0) {
                console.log(`✅ ${totalFound} jobs found, ${totalNew} new`);
            } else {
                console.log(`⚪ No jobs found`);
            }
            
        } catch (error) {
            this.log(`❌ Error scanning PLZ ${plz}: ${error.message}`);
        }
    }
    
    /**
     * Scan single job type for a postal code
     */
    async scanSingleType(scraper, postalCode) {
        try {
            // We'll use the existing API logic but just for one postal code
            const client = await pool.connect();
            
            try {
                const params = {
                    size: 100,
                    page: 1,
                    wo: postalCode,
                    umkreis: 5,
                    angebotsart: scraper.angebotsart,
                    veroeffentlichtseit: 2 // Last 2 days
                };
                
                const apiResult = await scraper.queryJobsForPostcode(postalCode);
                
                if (apiResult.success && apiResult.jobs.length > 0) {
                    // Process with intelligent duplicate detection
                    await scraper.processJobsIntelligently(apiResult.jobs, { postal_code: postalCode });
                }
                
                return {
                    totalJobsFound: apiResult.jobCount || 0,
                    newPositions: apiResult.jobs ? apiResult.jobs.length : 0, // Simplified for now
                    skippedDuplicates: 0 // Will be calculated in processing
                };
                
            } finally {
                client.release();
            }
            
        } catch (error) {
            this.log(`❌ Error in scanSingleType for ${postalCode}: ${error.message}`);
            return { totalJobsFound: 0, newPositions: 0, skippedDuplicates: 0 };
        }
    }
    
    /**
     * Print progress statistics
     */
    printProgress() {
        const elapsed = Math.round((new Date() - this.stats.startTime) / 1000);
        const rate = Math.round(this.stats.totalPlzScanned / (elapsed / 60)); // PLZ per minute
        
        console.log(`\n📈 DAILY FRESH SCAN PROGRESS:`);
        console.log(`   PLZ processed: ${this.stats.totalPlzScanned}`);
        console.log(`   Jobs found: ${this.stats.jobsFound}`);
        console.log(`   Ausbildung found: ${this.stats.ausbildungFound}`);
        console.log(`   New positions: ${this.stats.newPositions}`);
        console.log(`   Zero result PLZ: ${this.stats.zeroResultPlz}`);
        console.log(`   Rate: ${rate} PLZ/min`);
    }
    
    /**
     * Print final statistics and insights
     */
    async printFinalStats() {
        const duration = Math.round((new Date() - this.stats.startTime) / 1000);
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        
        console.log(`\n📊 DAILY FRESH SCAN COMPLETED`);
        console.log(`===============================`);
        console.log(`Session: ${this.sessionId}`);
        console.log(`Duration: ${hours}h ${minutes}m`);
        console.log(`PLZ scanned: ${this.stats.totalPlzScanned}`);
        console.log(`Jobs found: ${this.stats.jobsFound}`);
        console.log(`Ausbildung found: ${this.stats.ausbildungFound}`);
        console.log(`New positions: ${this.stats.newPositions}`);
        console.log(`Duplicates skipped: ${this.stats.duplicatesSkipped}`);
        console.log(`Zero result PLZ: ${this.stats.zeroResultPlz} (${(this.stats.zeroResultPlz / this.stats.totalPlzScanned * 100).toFixed(1)}%)`);
        console.log(`API calls: ${this.stats.apiCalls}`);
        
        // Show insights for optimization
        console.log(`\n💡 OPTIMIZATION INSIGHTS:`);
        console.log(`   Productive PLZ: ${this.stats.totalPlzScanned - this.stats.zeroResultPlz} (${((this.stats.totalPlzScanned - this.stats.zeroResultPlz) / this.stats.totalPlzScanned * 100).toFixed(1)}%)`);
        console.log(`   Avg jobs per productive PLZ: ${((this.stats.jobsFound + this.stats.ausbildungFound) / (this.stats.totalPlzScanned - this.stats.zeroResultPlz)).toFixed(1)}`);
        
        this.log(`✅ Scan completed: ${this.stats.newPositions} new positions from ${this.stats.totalPlzScanned} PLZ`);
    }
    
    /**
     * Analyze PLZ performance and suggest optimizations
     */
    async analyzePerformance() {
        try {
            const performance = JSON.parse(fs.readFileSync(this.performanceFile, 'utf8'));
            
            // Find consistently zero-result PLZ
            const zeroResultPlz = Object.entries(performance)
                .filter(([plz, data]) => data.zeroResultDays >= 5) // 5+ days without results
                .sort((a, b) => b[1].zeroResultDays - a[1].zeroResultDays);
            
            // Find most productive PLZ
            const productivePlz = Object.entries(performance)
                .filter(([plz, data]) => data.avgJobsPerScan > 0)
                .sort((a, b) => b[1].avgJobsPerScan - a[1].avgJobsPerScan)
                .slice(0, 20);
            
            console.log(`\n📊 PLZ PERFORMANCE ANALYSIS:`);
            console.log(`============================`);
            console.log(`Zero-result PLZ (5+ days): ${zeroResultPlz.length}`);
            console.log(`Top productive PLZ: ${productivePlz.length}`);
            
            if (zeroResultPlz.length > 100) {
                console.log(`\n💡 OPTIMIZATION SUGGESTION:`);
                console.log(`Consider excluding ${zeroResultPlz.length} consistently empty PLZ`);
                console.log(`This would reduce scan time by ~${(zeroResultPlz.length / Object.keys(performance).length * 100).toFixed(1)}%`);
            }
            
        } catch (error) {
            console.log('📊 Performance analysis not available yet (need more scan data)');
        }
    }
}

// CLI interface
async function main() {
    const scanner = new DailyFreshScanner();
    
    try {
        await scanner.runDailyFreshScan();
        await scanner.analyzePerformance();
        
    } catch (error) {
        console.error('❌ Daily Fresh Scan failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Export for use in other scripts or run directly
if (require.main === module) {
    main();
}

module.exports = DailyFreshScanner;