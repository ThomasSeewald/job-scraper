const puppeteer = require('puppeteer');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');
const EmailExtractor = require('./src/email-extractor');

async function testPostCaptchaContent() {
    console.log('🔍 Testing content after CAPTCHA solving...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    const captchaSolver = new IndependentCaptchaSolver();
    const emailExtractor = new EmailExtractor();
    
    try {
        const testUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1201370366-S';
        console.log(`🌐 Loading: ${testUrl}`);
        
        await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('📄 BEFORE CAPTCHA - Page content analysis:');
        let content = await page.content();
        console.log(`Content length: ${content.length} characters`);
        
        let emails = emailExtractor.extractPrioritizedEmails(content);
        console.log(`Emails found: ${emails.emailCount} - "${emails.emails}"`);
        
        // Look for CAPTCHA
        const captchaImg = await page.$('img[src*="captcha"]');
        if (!captchaImg) {
            console.log('❌ No CAPTCHA found - maybe already solved or page changed');
            return;
        }
        
        console.log('\n🔒 CAPTCHA detected, solving...');
        
        // Solve CAPTCHA
        const imageBuffer = await captchaImg.screenshot();
        const solution = await captchaSolver.solveCaptchaFromBuffer(imageBuffer);
        
        if (solution.success) {
            console.log(`✅ CAPTCHA solved: "${solution.text}"`);
            
            // Find and fill input
            const inputField = await page.$('input[name*="captcha"], input[id*="captcha"], input[type="text"]');
            if (inputField) {
                await inputField.type(solution.text);
                console.log('✅ CAPTCHA solution entered');
                
                // Submit
                const submitButton = await page.$('button[type="submit"], input[type="submit"]');
                if (submitButton) {
                    console.log('🚀 Submitting CAPTCHA...');
                    await submitButton.click();
                    
                    // Wait for page to process
                    console.log('⏳ Waiting for page to process...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    console.log('\n📄 AFTER CAPTCHA - Page content analysis:');
                    content = await page.content();
                    console.log(`Content length: ${content.length} characters`);
                    
                    emails = emailExtractor.extractPrioritizedEmails(content);
                    console.log(`Emails found: ${emails.emailCount} - "${emails.emails}"`);
                    
                    // Look for specific sections that might contain contact info
                    const sections = [
                        'stellenbeschreibung',
                        'bewerbung',
                        'kontakt',
                        'arbeitgeber',
                        'ansprechpartner'
                    ];
                    
                    console.log('\n🔍 Searching for contact sections:');
                    for (const section of sections) {
                        const elements = await page.$$(`[class*="${section}"], [id*="${section}"], [data-*="${section}"]`);
                        if (elements.length > 0) {
                            console.log(`✅ Found ${elements.length} ${section} elements`);
                            
                            for (let i = 0; i < Math.min(elements.length, 2); i++) {
                                const text = await page.evaluate(el => el.innerText || el.textContent, elements[i]);
                                const sectionEmails = emailExtractor.extractPrioritizedEmails(text);
                                if (sectionEmails.emailCount > 0) {
                                    console.log(`   📧 Section emails: ${sectionEmails.emails}`);
                                }
                            }
                        }
                    }
                    
                    // Look for any new text that appeared
                    const textContent = await page.evaluate(() => document.body.innerText);
                    console.log('\n📝 Page text content (last 1000 chars):');
                    console.log(textContent.slice(-1000));
                    
                    // Check for any mailto links
                    const mailtoLinks = await page.$$eval('a[href^="mailto:"]', links => 
                        links.map(link => link.href)
                    );
                    if (mailtoLinks.length > 0) {
                        console.log('📬 Mailto links found:', mailtoLinks);
                    }
                    
                    // Take a screenshot for manual inspection
                    await page.screenshot({ path: 'post-captcha-page.png', fullPage: true });
                    console.log('📸 Screenshot saved as post-captcha-page.png');
                    
                } else {
                    console.log('❌ No submit button found');
                }
            } else {
                console.log('❌ No input field found');
            }
        } else {
            console.log('❌ CAPTCHA solving failed');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        console.log('\n🛑 Keeping browser open for manual inspection');
        // Don't close browser for manual inspection
    }
}

testPostCaptchaContent();