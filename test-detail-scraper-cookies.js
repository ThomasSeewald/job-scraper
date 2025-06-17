const SimplifiedDetailScraper = require('./src/newest-jobs-scraper');

async function testDetailScraper() {
    const scraper = new SimplifiedDetailScraper();
    
    try {
        console.log('🚀 Testing detail scraper with cookie handling...\n');
        
        // Process just 1 job for testing
        await scraper.startScraping(1);
        
        console.log(`\n✅ Test completed.`);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testDetailScraper().catch(console.error);