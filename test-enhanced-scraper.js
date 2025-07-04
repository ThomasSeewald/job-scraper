const EnhancedIntelligentJobScraper = require('./src/enhanced-intelligent-scraper');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

/**
 * Test the Enhanced Intelligent Scraper with detail scraping
 */
async function testEnhancedScraper() {
    console.log('🧪 Testing Enhanced Intelligent Scraper with Detail Extraction');
    console.log('==============================================================');
    
    try {
        console.log('🔍 Testing with limited scope: 5 PLZ, 2 days, detail every 2 jobs');
        
        // Create enhanced scraper with detail scraping enabled
        const enhancedScraper = new EnhancedIntelligentJobScraper(
            'job',          // Job type
            2,              // Published since (days)
            true            // Enable detail scraping
        );
        
        console.log('\n🚀 Starting enhanced test scan...');
        
        // Run with small numbers for testing
        const results = await enhancedScraper.runEnhancedScraping(
            5,              // 5 postal codes only
            2               // Detail scrape every 2 new jobs
        );
        
        console.log('\n✅ Enhanced scraper test completed!');
        console.log('📊 Final Results:');
        console.log(`   API calls: ${results.totalApiCalls}`);
        console.log(`   Jobs found: ${results.totalJobsFound}`);
        console.log(`   New positions: ${results.newPositions}`);
        console.log(`   Details attempted: ${results.detailsAttempted}`);
        console.log(`   Details successful: ${results.detailsSuccessful}`);
        console.log(`   Details with contact: ${results.detailsWithContact}`);
        console.log(`   Detail errors: ${results.detailErrors}`);
        
        // Check database results
        console.log('\n📋 Checking database for detail results...');
        const client = await pool.connect();
        try {
            const detailCount = await client.query("SELECT COUNT(*) as count FROM 2163job_scrp_job_details WHERE scraped_at > NOW() - INTERVAL '5 minutes'");
            const contactCount = await client.query("SELECT COUNT(*) as count FROM 2309job_scrp_job_details WHERE has_contact_info = true AND scraped_at > NOW() - INTERVAL '5 minutes'");
            
            console.log(`📊 Database Results:`);
            console.log(`   Details stored: ${detailCount.rows[0].count}`);
            console.log(`   With contact info: ${contactCount.rows[0].count}`);
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Enhanced scraper test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await pool.end();
    }
}

// Run the test
testEnhancedScraper();