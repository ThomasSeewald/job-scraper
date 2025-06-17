const puppeteer = require('puppeteer');
const EmailExtractor = require('./src/email-extractor');

async function testEmailExtraction() {
    console.log('🔍 Testing email extraction from Arbeitsagentur job page...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    const emailExtractor = new EmailExtractor();
    
    try {
        // Test with a sample job
        const testUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1201370366-S';
        console.log(`🌐 Loading: ${testUrl}`);
        
        await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get page content
        const html = await page.content();
        console.log(`📄 Page HTML length: ${html.length} characters`);
        
        // Save a snippet to see what we're working with
        const textContent = await page.evaluate(() => document.body.innerText);
        console.log('\n📝 Page text content (first 1000 chars):');
        console.log(textContent.substring(0, 1000));
        
        // Test email extraction
        const emailResult = emailExtractor.extractPrioritizedEmails(
            html, 
            'Test Job Title', 
            'Test Company'
        );
        
        console.log('\n📧 Email extraction results:');
        console.log('Emails found:', emailResult.emails);
        console.log('Best email:', emailResult.bestEmail);
        console.log('Domain:', emailResult.domain);
        console.log('Email count:', emailResult.emailCount);
        console.log('All found emails:', emailResult.allFoundEmails);
        
        // Let's also manually search for email patterns
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const manualEmails = html.match(emailRegex) || [];
        console.log('\n🔍 Manual regex search found:', manualEmails.length, 'emails');
        console.log('Manual emails:', manualEmails.slice(0, 10)); // Show first 10
        
        // Check for specific German job-related terms that might indicate contact info
        const contactTerms = ['bewerbung', 'kontakt', 'ansprechpartner', 'email', 'e-mail'];
        console.log('\n🎯 Contact-related terms found:');
        contactTerms.forEach(term => {
            const count = (textContent.toLowerCase().match(new RegExp(term, 'g')) || []).length;
            if (count > 0) {
                console.log(`  ${term}: ${count} times`);
            }
        });
        
        // Take a screenshot for debugging
        await page.screenshot({ path: 'test-page-screenshot.png', fullPage: true });
        console.log('\n📸 Screenshot saved as test-page-screenshot.png');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
}

testEmailExtraction();