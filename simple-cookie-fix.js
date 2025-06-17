const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function acceptCookies() {
    const userDataDir = path.join(os.homedir(), '.job-scraper-cookies');
    const cookieFile = path.join(userDataDir, 'cookies_accepted');
    
    console.log('🍪 Simple Cookie Acceptance Script');
    console.log(`📁 User data directory: ${userDataDir}`);
    
    // Remove the old marker
    if (fs.existsSync(cookieFile)) {
        fs.unlinkSync(cookieFile);
        console.log('🗑️  Removed old cookie marker');
    }
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        userDataDir: userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    try {
        const page = await browser.newPage();
        
        console.log('🌐 Going to Arbeitsagentur...');
        await page.goto('https://www.arbeitsagentur.de', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        // Wait a bit for the cookie modal to appear
        console.log('⏳ Waiting for cookie modal...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Try to click the accept button using XPath
        console.log('🔍 Looking for cookie accept button...');
        
        try {
            // Method 1: XPath with exact text
            const [acceptButton] = await page.$x("//button[contains(text(), 'Alle Cookies akzeptieren')]");
            if (acceptButton) {
                console.log('✅ Found button via XPath');
                await acceptButton.click();
                console.log('🖱️  Clicked accept button');
                
                // Mark as accepted
                fs.writeFileSync(cookieFile, 'true');
                
                // Wait for modal to close
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                console.log('✅ Cookies accepted successfully!');
                console.log('✅ You can now close this browser and restart your scrapers');
                
                // Keep browser open to verify
                console.log('\n⏳ Keeping browser open. Press Ctrl+C when ready to close...');
                await new Promise(() => {}); // Keep running
            } else {
                // Method 2: Try clicking by evaluating in page context
                console.log('🔍 Trying alternative method...');
                
                const clicked = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    for (const button of buttons) {
                        if (button.textContent.includes('Alle Cookies akzeptieren')) {
                            button.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (clicked) {
                    console.log('✅ Successfully clicked cookie button!');
                    fs.writeFileSync(cookieFile, 'true');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    console.log('✅ Cookies accepted successfully!');
                    console.log('\n⏳ Keeping browser open. Press Ctrl+C when ready to close...');
                    await new Promise(() => {});
                } else {
                    console.log('❌ Could not find cookie button');
                    console.log('📸 Taking screenshot...');
                    await page.screenshot({ path: 'cookie-not-found.png' });
                    
                    // Log all button texts
                    const buttonTexts = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
                    });
                    console.log('📋 All buttons found:', buttonTexts);
                }
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            await page.screenshot({ path: 'cookie-error.png' });
        }
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
    }
}

acceptCookies().catch(console.error);