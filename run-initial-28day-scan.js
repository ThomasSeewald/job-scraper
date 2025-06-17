const IntelligentJobScraper = require('./src/intelligent-api-scraper');

/**
 * Initial 28-day scan for both Jobs and Ausbildung
 * This is the comprehensive initial scan to populate the database
 */
async function runInitial28DayScan() {
    console.log('🚀 OPTIMIZED 28-DAY COMPREHENSIVE SCAN');
    console.log('======================================');
    console.log('This will scan Jobs and Ausbildung published in the last 28 days');
    console.log('Running sequentially with smaller batches for better performance\n');
    
    try {
        // Run scrapers sequentially to avoid overwhelming the system
        console.log('📋 Starting JOBS scraper (28 days)...');
        const jobScraper = new IntelligentJobScraper('job', 28);
        const jobResults = await jobScraper.runIntelligentScraping(50); // Reduced to 50 postal codes
        
        console.log('\n🎓 Starting AUSBILDUNG scraper (28 days)...');
        const ausbildungScraper = new IntelligentJobScraper('ausbildung', 28);
        const ausbildungResults = await ausbildungScraper.runIntelligentScraping(50); // Reduced to 50 postal codes
        
        console.log('\n🎉 INITIAL 28-DAY SCAN COMPLETED!');
        console.log('==================================');
        
        console.log('\n📊 JOBS SUMMARY:');
        console.log(`   New job_scrp_employers: ${jobResults.newEmployers}`);
        console.log(`   New positions: ${jobResults.newPositions}`);
        console.log(`   Duplicates skipped: ${jobResults.skippedDuplicates}`);
        console.log(`   API calls: ${jobResults.totalApiCalls}`);
        console.log(`   Jobs found: ${jobResults.totalJobsFound}`);
        
        console.log('\n🎓 AUSBILDUNG SUMMARY:');
        console.log(`   New job_scrp_employers: ${ausbildungResults.newEmployers}`);
        console.log(`   New positions: ${ausbildungResults.newPositions}`);
        console.log(`   Duplicates skipped: ${ausbildungResults.skippedDuplicates}`);
        console.log(`   API calls: ${ausbildungResults.totalApiCalls}`);
        console.log(`   Jobs found: ${ausbildungResults.totalJobsFound}`);
        
        const totalNew = jobResults.newPositions + ausbildungResults.newPositions;
        const totalDuplicates = jobResults.skippedDuplicates + ausbildungResults.skippedDuplicates;
        const totalFound = jobResults.totalJobsFound + ausbildungResults.totalJobsFound;
        
        console.log('\n🔢 COMBINED TOTALS:');
        console.log(`   Total new positions: ${totalNew}`);
        console.log(`   Total duplicates skipped: ${totalDuplicates}`);
        console.log(`   Total jobs processed: ${totalFound}`);
        console.log(`   Efficiency: ${(totalNew / Math.max(totalFound, 1) * 100).toFixed(1)}% new positions`);
        console.log(`   Duplicate detection: ${(totalDuplicates / Math.max(totalFound, 1) * 100).toFixed(1)}% already known`);
        
        console.log('\n✅ System is now ready for daily 7-day maintenance scans!');
        
    } catch (error) {
        console.error('❌ Initial 28-day scan failed:', error.message);
        process.exit(1);
    }
}

// Run the initial scan
runInitial28DayScan();