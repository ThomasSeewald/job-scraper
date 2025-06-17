const SimplifiedDetailScraper = require('./src/newest-jobs-scraper');

async function testCookieFix() {
    const scraper = new SimplifiedDetailScraper();
    
    try {
        console.log('🚀 Testing updated cookie handling...\n');
        
        // Process just 1 job to test
        await scraper.startScraping(1);
        
        console.log('\n✅ Test completed successfully');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testCookieFix().catch(console.error);