const puppeteer = require('puppeteer');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');

async function debugCaptcha() {
    console.log('🔍 Debugging CAPTCHA detection and solving...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    const captchaSolver = new IndependentCaptchaSolver();
    
    try {
        const testUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1201370366-S';
        console.log(`🌐 Loading: ${testUrl}`);
        
        await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('🔍 Looking for CAPTCHA elements...');
        
        // Check for different CAPTCHA selectors
        const captchaSelectors = [
            'img[src*="captcha"]',
            'img[alt*="captcha"]', 
            'img[alt*="Captcha"]',
            'img[title*="captcha"]',
            '.captcha img',
            '#captcha img',
            'img[src*="challenge"]',
            'canvas[id*="captcha"]'
        ];
        
        let captchaFound = false;
        let captchaElement = null;
        
        for (const selector of captchaSelectors) {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
                console.log(`✅ Found CAPTCHA with selector: ${selector} (${elements.length} elements)`);
                captchaElement = elements[0];
                captchaFound = true;
                
                // Get image attributes
                const src = await page.evaluate(el => el.src, captchaElement);
                const alt = await page.evaluate(el => el.alt, captchaElement);
                const dimensions = await page.evaluate(el => ({
                    width: el.width,
                    height: el.height,
                    naturalWidth: el.naturalWidth,
                    naturalHeight: el.naturalHeight
                }), captchaElement);
                
                console.log(`📊 CAPTCHA details:`);
                console.log(`   Source: ${src}`);
                console.log(`   Alt text: ${alt}`);
                console.log(`   Dimensions: ${dimensions.width}x${dimensions.height}`);
                console.log(`   Natural: ${dimensions.naturalWidth}x${dimensions.naturalHeight}`);
                
                break;
            }
        }
        
        if (!captchaFound) {
            console.log('❌ No CAPTCHA found with standard selectors');
            
            // Look for any images on the page
            const allImages = await page.$$('img');
            console.log(`📷 Total images on page: ${allImages.length}`);
            
            for (let i = 0; i < Math.min(allImages.length, 5); i++) {
                const img = allImages[i];
                const src = await page.evaluate(el => el.src, img);
                const alt = await page.evaluate(el => el.alt, img);
                console.log(`   Image ${i + 1}: ${src} (alt: "${alt}")`);
            }
            
            return;
        }
        
        // Try to screenshot the CAPTCHA
        console.log('📸 Taking CAPTCHA screenshot...');
        try {
            const imageBuffer = await captchaElement.screenshot();
            console.log(`📊 CAPTCHA image buffer size: ${imageBuffer.length} bytes`);
            
            if (imageBuffer.length === 0) {
                console.log('❌ CAPTCHA image buffer is empty!');
                return;
            }
            
            // Save for inspection
            require('fs').writeFileSync('captcha-debug.png', imageBuffer);
            console.log('💾 CAPTCHA saved as captcha-debug.png');
            
            // Try to solve
            console.log('🧩 Attempting to solve CAPTCHA...');
            const solution = await captchaSolver.solveCaptchaFromBuffer(imageBuffer, 'captcha-debug.png');
            
            if (solution.success) {
                console.log(`✅ CAPTCHA solved: "${solution.text}"`);
                
                // Look for input field
                const inputSelectors = [
                    'input[name*="captcha"]',
                    'input[id*="captcha"]',
                    'input[placeholder*="captcha"]',
                    'input[type="text"]'
                ];
                
                let inputFound = false;
                for (const selector of inputSelectors) {
                    const inputs = await page.$$(selector);
                    if (inputs.length > 0) {
                        console.log(`✅ Found input field: ${selector}`);
                        const input = inputs[0];
                        
                        await input.type(solution.text);
                        console.log('✅ CAPTCHA solution entered');
                        
                        // Look for submit button
                        const submitSelectors = [
                            'button[type="submit"]',
                            'input[type="submit"]',
                            'button:contains("Absenden")',
                            'button:contains("Weiter")'
                        ];
                        
                        for (const btnSelector of submitSelectors) {
                            const buttons = await page.$$(btnSelector);
                            if (buttons.length > 0) {
                                console.log(`🚀 Clicking submit button: ${btnSelector}`);
                                await buttons[0].click();
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                
                                // Check if page changed
                                const newContent = await page.content();
                                const emails = newContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
                                console.log(`📧 Emails found after CAPTCHA: ${emails.length}`);
                                if (emails.length > 0) {
                                    console.log(`✅ Found emails: ${emails.slice(0, 5)}`);
                                }
                                
                                inputFound = true;
                                break;
                            }
                        }
                        
                        if (inputFound) break;
                    }
                }
                
                if (!inputFound) {
                    console.log('❌ No suitable input field found for CAPTCHA');
                }
                
            } else {
                console.log(`❌ CAPTCHA solving failed: ${solution.error}`);
            }
            
        } catch (error) {
            console.log(`❌ CAPTCHA screenshot failed: ${error.message}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        console.log('🛑 Keeping browser open for manual inspection (close manually)');
        // Don't close browser so we can inspect manually
        // await browser.close();
    }
}

debugCaptcha();