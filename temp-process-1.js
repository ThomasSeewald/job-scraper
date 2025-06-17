
const puppeteer = require('puppeteer');
const EmailExtractor = require('./src/email-extractor');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');

async function processSingleEmployer() {
    console.log('🚀 Process 1 starting for employer: ENERCON GmbH');
    console.log('🔗 URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/17402-43435226-65-S');
    
    const emailExtractor = new EmailExtractor();
    const captchaSolver = new IndependentCaptchaSolver();
    
    // Launch browser in VISIBLE mode
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1200,800',
            '--window-position=100,100'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    try {
        // Navigate to the job detail page
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/17402-43435226-65-S', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Check for CAPTCHA
        const captchaSelector = 'img[src*="captcha"]';
        const captchaImage = await page.$(captchaSelector);
        
        if (captchaImage) {
            console.log('🧩 Process 1: CAPTCHA DETECTED!');
            
            // Get CAPTCHA image source
            const captchaSrc = await captchaImage.evaluate(el => el.src);
            console.log('📸 CAPTCHA source:', captchaSrc);
            
            // Solve CAPTCHA
            const solutionResult = await captchaSolver.solveCaptchaFromUrl(captchaSrc);
            if (solutionResult.success) {
                console.log('✅ CAPTCHA solution:', solutionResult.text);
                
                // Enter solution
                await page.type('input[name="captcha"], input[type="text"]', solutionResult.text);
                
                // Submit
                await page.click('button[type="submit"], input[type="submit"]');
                console.log('📤 CAPTCHA submitted - waiting for verification...');
                
                // Wait for verification
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Check if CAPTCHA is gone
                const stillHasCaptcha = await page.$(captchaSelector);
                if (!stillHasCaptcha) {
                    console.log('✅ Process 1: CAPTCHA SOLVED SUCCESSFULLY!');
                } else {
                    console.log('❌ Process 1: CAPTCHA still present');
                }
            } else {
                console.log('❌ CAPTCHA solving failed');
            }
        } else {
            console.log('🆓 Process 1: NO CAPTCHA - FREE ACCESS!');
        }
        
        // Extract emails
        const pageContent = await page.content();
        const emailResult = emailExtractor.extractEmails(pageContent, 'Commercial Administrator (m/w/d)', 'ENERCON GmbH');
        
        console.log('\n📊 Process 1 Results:');
        console.log('   Employer: ENERCON GmbH');
        console.log('   Direct emails found:', emailResult.emails || 'None');
        console.log('   Website found:', emailResult.applicationWebsite || 'None');
        
        console.log('\n✅ Process 1 completed - browser remains open for inspection');
        console.log('🔍 You can now inspect the page and close the browser when ready');
        
    } catch (error) {
        console.error('❌ Process 1 error:', error.message);
    }
    
    // Keep the process alive - DO NOT close browser
    console.log('⏸️ Process 1 waiting... (Press Ctrl+C to exit this process)');
    process.on('SIGINT', () => {
        console.log('\n🛑 Process 1 received exit signal - closing browser...');
        browser.close().then(() => {
            console.log('🧹 Process 1 browser closed');
            process.exit(0);
        });
    });
    
    await new Promise(() => {}); // Wait forever
}

processSingleEmployer().catch(console.error);
