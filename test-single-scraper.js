const BatchEmployerScraper = require('./src/batch-employer-scraper');

async function testSingleScraper() {
    const scraper = new BatchEmployerScraper();
    
    try {
        console.log('🚀 Starting test scraper...');
        
        // Create a test batch with just one employer
        const testBatch = [{
            id: 1,
            name: "Test Employer",
            normalized_name: "test employer",
            refnr: "10000-1202732275-S",
            titel: "Test Job",
            arbeitsort_ort: "Berlin",
            arbeitsort_plz: "10623",
            aktuelleveroeffentlichungsdatum: "2025-06-05T22:00:00.000Z"
        }];
        
        // Write test batch to file
        const fs = require('fs');
        fs.writeFileSync('/Users/thomassee/Docker/containers/job-scraper/test_batch.json', JSON.stringify(testBatch, null, 2));
        
        // Initialize browser in non-headless mode to see what's happening
        process.env.HEADLESS_MODE = 'false';
        await scraper.initializeBrowser();
        
        // Process the test batch
        await scraper.processBatchFile('/Users/thomassee/Docker/containers/job-scraper/test_batch.json');
        
        console.log('✅ Test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await scraper.cleanup();
    }
}

testSingleScraper();