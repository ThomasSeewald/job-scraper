
const puppeteer = require('puppeteer');
const EmailExtractor = require('./src/email-extractor');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');
const DomainEmailExtractor = require('./src/domain-email-extractor');
const PortalDetector = require('./src/portal-detector');

async function processSingleEmployer() {
    console.log('🚀 Process 2 starting for employer: ARWA Personaldienstleistungen GmbH Chemnitz-Süd');
    console.log('🔗 URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/14385-419-2355562-25-S');
    
    const emailExtractor = new EmailExtractor();
    const captchaSolver = new IndependentCaptchaSolver();
    const domainExtractor = new DomainEmailExtractor();
    const portalDetector = new PortalDetector();
    
    // Launch browser in VISIBLE mode
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1200,800',
            '--window-position=350,150'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    try {
        // Navigate to the job detail page
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/14385-419-2355562-25-S', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Check for CAPTCHA
        const captchaSelector = 'img[src*="captcha"]';
        const captchaImage = await page.$(captchaSelector);
        
        if (captchaImage) {
            console.log('🧩 Process 2: CAPTCHA detected!');
            
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
                console.log('📤 CAPTCHA submitted');
                
                // Wait for verification
                await page.waitForTimeout(5000);
            } else {
                console.log('❌ CAPTCHA solving failed');
            }
        }
        
        // Extract emails
        const pageContent = await page.content();
        const emailResult = emailExtractor.extractEmails(pageContent, 'Konstrukteur (m/w/d) ', 'ARWA Personaldienstleistungen GmbH Chemnitz-Süd');
        
        console.log('\n📊 Process 2 Results:');
        console.log('   Employer: ARWA Personaldienstleistungen GmbH Chemnitz-Süd');
        console.log('   Direct emails found:', emailResult.emails || 'None');
        console.log('   Website found:', emailResult.applicationWebsite || 'None');
        
        // Check for domain extraction opportunity
        if (!emailResult.emails && emailResult.applicationWebsite) {
            const portalCheck = portalDetector.detectPortal(emailResult.applicationWebsite);
            console.log('   Portal detection:', portalCheck.isPortal ? 'PORTAL' : 'LEGITIMATE', '(' + portalCheck.confidence + ')');
            
            if (!portalCheck.isPortal || portalCheck.confidence < 0.8) {
                console.log('   Would attempt domain extraction from:', emailResult.applicationWebsite);
            } else {
                console.log('   Skipping domain extraction - detected as', portalCheck.category);
            }
        }
        
        console.log('\n✅ Process 2 completed - browser remains open for inspection');
        console.log('🔍 You can now inspect the page and close the browser when ready');
        
    } catch (error) {
        console.error('❌ Process 2 error:', error.message);
    }
    
    // Keep the process alive - DO NOT close browser
    console.log('⏸️ Process 2 waiting... (Press Ctrl+C to exit)');
    await new Promise(() => {}); // Wait forever
}

processSingleEmployer().catch(console.error);
