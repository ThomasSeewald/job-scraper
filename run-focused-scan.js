const IntelligentJobScraper = require('./src/intelligent-api-scraper');

/**
 * Focused scan for testing and incremental progress
 * Smaller batches for faster completion and better monitoring
 */
async function runFocusedScan() {
    console.log('🎯 FOCUSED 28-DAY SCAN');
    console.log('======================');
    console.log('Testing optimized scraper with small batches');
    console.log('Running Jobs first, then Ausbildung\n');
    
    try {
        // Phase 1: Jobs scraper (small batch for testing)
        console.log('📋 Phase 1: JOBS scraper (28 days)...');
        const jobScraper = new IntelligentJobScraper('job', 28);
        const jobResults = await jobScraper.runIntelligentScraping(20); // Only 20 postal codes
        
        console.log('\n⏸️  Phase 1 completed. Taking 5-second break...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Phase 2: Ausbildung scraper (small batch for testing)
        console.log('\n🎓 Phase 2: AUSBILDUNG scraper (28 days)...');
        const ausbildungScraper = new IntelligentJobScraper('ausbildung', 28);
        const ausbildungResults = await ausbildungScraper.runIntelligentScraping(20); // Only 20 postal codes
        
        console.log('\n🎉 FOCUSED SCAN COMPLETED!');
        console.log('===========================');
        
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
        
        console.log('\n✅ Ready to scale up to larger batches!');
        
    } catch (error) {
        console.error('❌ Focused scan failed:', error.message);
        process.exit(1);
    }
}

// Run the focused scan
runFocusedScan();