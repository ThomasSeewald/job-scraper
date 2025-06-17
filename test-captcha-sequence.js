const puppeteer = require('puppeteer');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');

async function testCaptchaSequence() {
    const captchaSolver = new IndependentCaptchaSolver();
    
    console.log('🧪 Testing CAPTCHA sequence logic...');
    console.log('📋 Theory: First page = CAPTCHA, next ~19 pages = no CAPTCHA');
    
    const browser = await puppeteer.launch({
        headless: false, // Visible for demonstration
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Real job URLs WITHOUT external URLs (from database - January 6, 2025)
    const testUrls = [
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14340-402379417-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14340-402380123-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/13091-13278979-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/13091-13278982-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14340-402379489-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14340-402379802-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14385-457-2355398-25-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1001480552-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/14340-402379942-S',
        'https://www.arbeitsagentur.de/jobsuche/jobdetail/13091-13278972-S'
    ];
    
    console.log('🔄 Automatically skipping expired pages ("existiert nicht mehr")');
    console.log('🎯 Looking for valid job pages to test CAPTCHA sequence');
    
    let captchaCount = 0;
    let validPagesCount = 0;
    let expiredPagesCount = 0;
    
    for (let i = 0; i < testUrls.length; i++) {
        console.log(`\n📄 Testing page ${i + 1}/${testUrls.length}: ${testUrls[i]}`);
        
        try {
            await page.goto(testUrls[i], { 
                waitUntil: 'networkidle2', 
                timeout: 15000 
            });
            
            // Wait a moment for page to fully load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check for CAPTCHA
            const captchaSelector = 'img[src*="captcha"]';
            const captchaImage = await page.$(captchaSelector);
            
            if (captchaImage) {
                captchaCount++;
                console.log(`🧩 CAPTCHA detected on page ${i + 1}! (Total CAPTCHAs: ${captchaCount})`);
                
                try {
                    // Get CAPTCHA image source
                    const captchaSrc = await captchaImage.evaluate(el => el.src);
                    console.log('📸 CAPTCHA image source found:', captchaSrc);

                    // Solve CAPTCHA
                    console.log('🔧 Attempting to solve CAPTCHA...');
                    const solutionResult = await captchaSolver.solveCaptchaFromUrl(captchaSrc);
                    const solution = solutionResult.success ? solutionResult.text : null;
                    
                    if (solution) {
                        console.log('✅ CAPTCHA solution received:', solution);
                        
                        // Find input field and enter solution
                        const inputSelector = 'input[name="captcha"], input[type="text"]';
                        await page.type(inputSelector, solution);
                        
                        // Submit form
                        const submitSelector = 'button[type="submit"], input[type="submit"]';
                        await page.click(submitSelector);
                        console.log('📤 CAPTCHA form submitted');
                        
                        // Wait for CAPTCHA to disappear (proper verification)
                        console.log('⏳ Waiting for CAPTCHA verification...');
                        let captchaGone = false;
                        for (let i = 0; i < 15; i++) {
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                            
                            // Check if CAPTCHA is still present
                            const stillHasCaptcha = await page.$(captchaSelector);
                            if (!stillHasCaptcha) {
                                captchaGone = true;
                                console.log(`✅ CAPTCHA disappeared after ${i + 1} seconds - solved successfully!`);
                                break;
                            }
                            
                            console.log(`⌛ Still waiting for CAPTCHA to disappear... (${i + 1}/15 seconds)`);
                        }
                        
                        if (!captchaGone) {
                            console.log('❌ CAPTCHA still present after 15 seconds - solution may be incorrect');
                            await browser.close();
                            return; // Stop test if CAPTCHA solving fails
                        }
                        
                        console.log('✅ CAPTCHA verification complete - continuing test');
                    } else {
                        console.log('❌ CAPTCHA solving failed - STOPPING TEST');
                        console.log('🛑 Cannot proceed without solving CAPTCHA');
                        await browser.close();
                        return; // Stop the test if CAPTCHA solving fails
                    }
                } catch (captchaError) {
                    console.log('❌ CAPTCHA solving error:', captchaError.message);
                }
            } else {
                console.log(`✅ No CAPTCHA on page ${i + 1} - session is active!`);
            }
            
            // Check page content in detail
            const pageText = await page.evaluate(() => document.body.textContent || '');
            
            if (pageText.includes('existiert nicht mehr') || pageText.includes('nicht mehr verfügbar')) {
                console.log('❌ Page shows "existiert nicht mehr" - SKIPPING (doesn\'t count toward CAPTCHA limit)');
                expiredPagesCount++;
                continue; // Skip expired pages
            } else if (pageText.includes('Stellenbeschreibung') || pageText.includes('Bewerbung') || pageText.includes('Stellenangebot')) {
                console.log('✅ Valid job page with content - COUNTS toward CAPTCHA limit');
                validPagesCount++;
                
                // Stop after we test a few valid pages to prove the concept
                if (validPagesCount >= 5) {
                    console.log(`\n🛑 Stopping after ${validPagesCount} valid pages to demonstrate CAPTCHA pattern`);
                    break;
                }
            } else {
                console.log('❓ Unknown page content type');
            }
            
            // Small delay between valid pages
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.log(`❌ Error on page ${i + 1}: ${error.message}`);
        }
    }
    
    console.log(`\n📊 Test Results:`);
    console.log(`   Total pages visited: ${testUrls.length}`);
    console.log(`   Valid job pages: ${validPagesCount}`);
    console.log(`   Expired pages (skipped): ${expiredPagesCount}`);
    console.log(`   CAPTCHAs encountered: ${captchaCount}`);
    
    if (validPagesCount > 0) {
        console.log(`\n🎯 CAPTCHA Pattern Analysis:`);
        if (captchaCount === 0) {
            console.log('✅ No CAPTCHAs on valid pages - session already established!');
        } else if (captchaCount === 1 && validPagesCount > 1) {
            console.log('✅ THEORY CONFIRMED: Only first valid page had CAPTCHA!');
        } else {
            console.log('❓ Unexpected CAPTCHA pattern - needs investigation');
        }
    } else {
        console.log('⚠️ No valid job pages found to test CAPTCHA sequence');
    }
    
    console.log('\n🔄 Test completed. Browser will remain open for final inspection.');
    console.log('Press ENTER to close browser and exit...');
    await new Promise(resolve => {
        process.stdin.once('data', () => resolve());
    });
    
    await browser.close();
    console.log('🧪 Test completed');
}

// Run the test
if (require.main === module) {
    testCaptchaSequence().catch(console.error);
}

module.exports = { testCaptchaSequence };