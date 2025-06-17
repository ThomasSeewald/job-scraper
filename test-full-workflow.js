const SimplifiedDetailScraper = require('./src/simplified-detail-scraper');

async function testFullWorkflow() {
    console.log('🧪 Testing full email extraction workflow...');
    
    const scraper = new SimplifiedDetailScraper();
    
    try {
        // Initialize browser
        await scraper.initializeBrowser();
        
        // Test with a specific job that we know triggers CAPTCHA
        const testJob = {
            refnr: '10000-1201370366-S',
            id: 123,
            titel: 'Ausbildungsplatz zum Industriekaufmann (m/w/d)',
            arbeitgeber: 'Dieffenbacher Maschinenfabrik GmbH',
            arbeitsort_ort: 'Zaisenhausen'
        };
        
        console.log('🎯 Testing with specific job that should trigger CAPTCHA...');
        const result = await scraper.scrapeJobDetail(testJob);
        
        console.log('\n📊 Scraping Results:');
        console.log('Success:', result.success);
        console.log('Emails found:', result.emails);
        console.log('Best email:', result.bestEmail);
        console.log('Domain:', result.domain);
        console.log('Email count:', result.emailCount);
        console.log('CAPTCHA solved:', result.captchaSolved);
        console.log('Duration:', result.duration, 'ms');
        
        if (result.error) {
            console.log('Error:', result.error);
        }
        
        // Save results to database
        await scraper.saveResults(testJob, result);
        console.log('💾 Results saved to database');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await scraper.cleanup();
    }
}

testFullWorkflow();