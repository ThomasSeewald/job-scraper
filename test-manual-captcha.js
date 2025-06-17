const puppeteer = require('puppeteer');
const fs = require('fs');

async function testManualCaptcha() {
    console.log('🔍 Testing manual CAPTCHA workflow...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    
    try {
        const testUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1201370366-S';
        console.log(`🌐 Loading: ${testUrl}`);
        
        await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Find CAPTCHA
        const captchaImg = await page.$('img[src*="captcha"]');
        if (!captchaImg) {
            console.log('❌ No CAPTCHA found');
            return;
        }
        
        console.log('✅ CAPTCHA found');
        
        // Get the CAPTCHA image source URL directly
        const captchaSrc = await page.evaluate(img => img.src, captchaImg);
        console.log(`🔗 CAPTCHA URL: ${captchaSrc}`);
        
        // Try downloading the image directly
        console.log('📥 Downloading CAPTCHA image directly...');
        const response = await page.goto(captchaSrc);
        const imageBuffer = await response.buffer();
        
        console.log(`📊 Direct download size: ${imageBuffer.length} bytes`);
        fs.writeFileSync('captcha-direct.png', imageBuffer);
        console.log('💾 Direct image saved as captcha-direct.png');
        
        // Go back to the job page
        await page.goto(testUrl, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try to solve CAPTCHA manually through browser interaction
        console.log('\n🖱️  MANUAL TESTING MODE:');
        console.log('1. The browser window should be open');
        console.log('2. Manually solve the CAPTCHA');
        console.log('3. Look for emails in the page content');
        console.log('4. Press Ctrl+C when done');
        
        // Wait for manual interaction
        let emailsFound = [];
        let checkCount = 0;
        
        const checkForEmails = async () => {
            checkCount++;
            const content = await page.content();
            const emails = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
            
            // Filter out arbeitsagentur emails
            const relevantEmails = emails.filter(email => 
                !email.includes('arbeitsagentur') && 
                !email.includes('bundesagentur')
            );
            
            if (relevantEmails.length > 0 && JSON.stringify(relevantEmails) !== JSON.stringify(emailsFound)) {
                emailsFound = relevantEmails;
                console.log(`\n✅ Check ${checkCount}: Found ${relevantEmails.length} relevant emails:`);
                relevantEmails.forEach(email => console.log(`   📧 ${email}`));
            } else if (checkCount % 10 === 0) {
                console.log(`⏱️  Check ${checkCount}: Still waiting for emails... (${emails.length} total emails found)`);
            }
        };
        
        // Check every 2 seconds
        const emailChecker = setInterval(checkForEmails, 2000);
        
        // Wait for a reasonable amount of time
        await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
        
        clearInterval(emailChecker);
        
        if (emailsFound.length > 0) {
            console.log(`\n🎉 SUCCESS! Found ${emailsFound.length} relevant emails after manual CAPTCHA solving:`);
            emailsFound.forEach(email => console.log(`   📧 ${email}`));
        } else {
            console.log('\n❌ No relevant emails found even after manual solving');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        console.log('\n🛑 Keeping browser open for inspection (close manually)');
        // Don't close browser
    }
}

testManualCaptcha();