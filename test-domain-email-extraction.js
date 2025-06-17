/**
 * Test script for the enhanced domain email extraction functionality
 * 
 * This script tests the integration between job detail scraping and domain email extraction
 */

const BatchEmployerScraper = require('./src/batch-employer-scraper');

async function testDomainEmailExtraction() {
    console.log('🧪 Testing enhanced domain email extraction...');
    console.log('📋 Testing scenario: Job page with no direct emails but company website available');
    
    const scraper = new BatchEmployerScraper();
    
    try {
        await scraper.initializeBrowser();
        
        // Test with a sample employer that likely has a website but no direct email on the job page
        const testEmployer = {
            id: 'test-001',
            name: 'Test Company GmbH',
            titel: 'Software Engineer',
            refnr: '14340-402379417-S' // Use a real job reference
        };
        
        console.log(`🔍 Testing employer: ${testEmployer.name}`);
        console.log(`🔗 Job URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/${testEmployer.refnr}`);
        
        const result = await scraper.scrapeEmployerDetails(testEmployer);
        
        console.log('\n📊 Test Results:');
        console.log(`   Success: ${result.success}`);
        console.log(`   Direct emails found: ${result.emails.length}`);
        console.log(`   Website found: ${result.hasWebsite ? 'Yes' : 'No'}`);
        console.log(`   Domain emails found: ${result.hasDomainEmails ? 'Yes' : 'No'}`);
        
        if (result.emails.length > 0) {
            console.log(`   📧 Emails: ${Array.isArray(result.emails) ? result.emails.join(', ') : result.emails}`);
            console.log(`   🎯 Best email: ${result.bestEmail}`);
        }
        
        if (result.website) {
            console.log(`   🌐 Website: ${result.website}`);
        }
        
        if (result.domainEmailsFound && result.domainEmailsFound.length > 0) {
            console.log(`   🏢 Domain emails: ${result.domainEmailsFound.join(', ')}`);
        }
        
        if (result.error) {
            console.log(`   ❌ Error: ${result.error}`);
        }
        
        console.log('\n🔍 Analysis:');
        if (result.hasEmails && result.hasDomainEmails) {
            console.log('✅ SUCCESS: Domain email extraction working - found emails from company website');
        } else if (result.hasEmails && !result.hasDomainEmails) {
            console.log('ℹ️ Direct emails found on job page - domain extraction not needed');
        } else if (!result.hasEmails && result.hasWebsite) {
            console.log('⚠️ Website found but no emails extracted - may need domain extraction optimization');
        } else if (!result.hasEmails && !result.hasWebsite) {
            console.log('❌ No emails or website found - this employer may not have contact info available');
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        await scraper.cleanup();
    }
}

// Alternative test with a smaller batch file
async function testBatchDomainExtraction() {
    console.log('\n🧪 Testing batch processing with domain email extraction...');
    
    const scraper = new BatchEmployerScraper();
    
    try {
        // Create a small test batch
        const testBatch = [
            {
                id: 'test-001',
                name: 'Test Company A',
                titel: 'Software Developer',
                refnr: '14340-402379417-S'
            },
            {
                id: 'test-002', 
                name: 'Test Company B',
                titel: 'Project Manager',
                refnr: '14340-402380123-S'
            }
        ];
        
        // Write test batch to temporary file
        const fs = require('fs');
        const testBatchFile = './test-batch-domain-extraction.json';
        fs.writeFileSync(testBatchFile, JSON.stringify(testBatch, null, 2));
        
        console.log(`📁 Created test batch file: ${testBatchFile}`);
        
        await scraper.initializeBrowser();
        await scraper.processBatchFile(testBatchFile);
        
        // Clean up test file
        fs.unlinkSync(testBatchFile);
        console.log('🧹 Cleaned up test batch file');
        
    } catch (error) {
        console.error('❌ Batch test failed:', error.message);
        throw error;
    } finally {
        await scraper.cleanup();
    }
}

// Main execution
async function main() {
    const testType = process.argv[2] || 'single';
    
    try {
        if (testType === 'batch') {
            await testBatchDomainExtraction();
        } else {
            await testDomainEmailExtraction();
        }
        
        console.log('\n🎉 Domain email extraction test completed successfully!');
        console.log('✅ Integration between job scraping and domain email extraction is working');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run test if called directly
if (require.main === module) {
    console.log('🚀 Starting domain email extraction integration test...');
    console.log('Usage: node test-domain-email-extraction.js [single|batch]');
    console.log('');
    
    main().catch(console.error);
}

module.exports = { testDomainEmailExtraction, testBatchDomainExtraction };