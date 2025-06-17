const SimplifiedDetailScraper = require('./src/newest-jobs-scraper');

async function testPersistentCookies() {
    const scraper = new SimplifiedDetailScraper();
    
    try {
        console.log('🚀 Testing persistent cookie handling...\n');
        
        // Process 5 jobs to test if cookies persist
        await scraper.startScraping(5);
        
        console.log('\n✅ Test completed - cookies should have persisted between pages');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testPersistentCookies().catch(console.error);