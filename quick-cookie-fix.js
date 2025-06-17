const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function quickCookieFix() {
    const userDataDir = path.join(os.homedir(), '.job-scraper-cookies');
    const cookieFile = path.join(userDataDir, 'cookies_accepted');
    
    console.log('🍪 Quick Cookie Fix for Arbeitsagentur');
    console.log(`📁 User data directory: ${userDataDir}`);
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        userDataDir: userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('🌐 Navigating to Arbeitsagentur...');
        await page.goto('https://www.arbeitsagentur.de', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        console.log('⏳ Waiting for page to load...');
        await page.waitForTimeout(3000);
        
        // Check for the cookie button
        const cookieButton = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
        
        if (cookieButton) {
            console.log('✅ Cookie modal found!');
            console.log('🖱️  Clicking accept button...');
            
            await page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            
            console.log('⏳ Waiting for modal to close...');
            await page.waitForTimeout(3000);
            
            // Mark cookies as accepted
            fs.writeFileSync(cookieFile, 'true');
            console.log('✅ Cookies accepted and saved!');
            
            // Test by navigating to another page
            console.log('\n🧪 Testing cookie persistence...');
            await page.goto('https://www.arbeitsagentur.de/jobsuche/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            
            await page.waitForTimeout(2000);
            
            // Check if cookie modal appears again
            const modalAgain = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            if (!modalAgain) {
                console.log('✅ Success! Cookies are working correctly');
            } else {
                console.log('⚠️  Cookie modal appeared again');
            }
            
        } else {
            console.log('ℹ️  No cookie modal found - cookies may already be accepted');
            
            // Still create the marker file
            fs.writeFileSync(cookieFile, 'true');
        }
        
        console.log('\n✅ Cookie fix complete!');
        console.log('📝 You can now restart your scrapers');
        console.log('\n⏳ Browser will close in 5 seconds...');
        
        await page.waitForTimeout(5000);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
}

quickCookieFix().catch(console.error);