const puppeteer = require('puppeteer');

async function testCookieAcceptance() {
    console.log('🧪 Testing cookie acceptance on Arbeitsagentur...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    try {
        console.log('📍 Navigating to https://www.arbeitsagentur.de...');
        await page.goto('https://www.arbeitsagentur.de', { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });
        
        console.log('🔍 Looking for cookie consent banner...');
        
        // Wait a bit for cookie banner to appear
        await page.waitForTimeout(2000);
        
        // Try to find and click cookie accept button
        const cookieAccepted = await page.evaluate(() => {
            // Look for common cookie accept buttons
            const selectors = [
                'button[class*="gdpr-button-accept"]',
                'button[data-ba-name="accept-all-cookies"]',
                '[data-ba-name="Cookie-Einstellungen-Alle-akzeptieren"]',
                'button:has-text("Alle akzeptieren")',
                'button[class*="accept-all"]',
                '#accept-all-cookies'
            ];
            
            for (const selector of selectors) {
                try {
                    const buttons = document.querySelectorAll(selector);
                    for (const button of buttons) {
                        if (button && button.offsetParent !== null) {
                            console.log('Found cookie button with selector:', selector);
                            button.click();
                            return true;
                        }
                    }
                } catch (e) {
                    // Continue with next selector
                }
            }
            
            // Also try text-based search
            const allButtons = document.querySelectorAll('button');
            for (const button of allButtons) {
                const text = button.textContent?.toLowerCase().trim() || '';
                if ((text.includes('alle akzeptieren') || 
                     text.includes('alle cookies') || 
                     text.includes('akzeptieren') && !text.includes('notwendige')) &&
                    button.offsetParent !== null) {
                    console.log('Found cookie button by text:', text);
                    button.click();
                    return true;
                }
            }
            
            return false;
        });
        
        if (cookieAccepted) {
            console.log('✅ Cookie consent accepted!');
        } else {
            console.log('❌ No cookie consent banner found or could not accept');
        }
        
        // Wait to see the result
        await page.waitForTimeout(3000);
        
        // Try navigating to a job detail page
        console.log('📍 Navigating to a job detail page...');
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1202690104-S', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('✅ Successfully navigated to job detail page');
        
        // Check if CAPTCHA is present
        const hasCaptcha = await page.$('img[src*="captcha"]');
        if (hasCaptcha) {
            console.log('🧩 CAPTCHA detected on page');
        } else {
            console.log('✅ No CAPTCHA on this page');
        }
        
        console.log('\n🎯 Test complete! Check the browser window.');
        console.log('Press Ctrl+C to close...');
        
        // Keep browser open for inspection
        await new Promise(() => {});
        
    } catch (error) {
        console.error('❌ Error during test:', error.message);
    }
}

testCookieAcceptance();