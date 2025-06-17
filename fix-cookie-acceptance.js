const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function fixCookieAcceptance() {
    const userDataDir = path.join(os.homedir(), '.job-scraper-cookies');
    const cookieFile = path.join(userDataDir, 'cookies_accepted');
    
    console.log('🔧 Cookie Acceptance Fix Script');
    console.log(`📁 User data directory: ${userDataDir}`);
    
    // Remove the cookie marker file to force re-acceptance
    if (fs.existsSync(cookieFile)) {
        fs.unlinkSync(cookieFile);
        console.log('🗑️  Removed old cookie marker file');
    }
    
    let browser;
    try {
        // Launch browser with same settings as scrapers
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: userDataDir,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('🌐 Navigating to Arbeitsagentur homepage...');
        await page.goto('https://www.arbeitsagentur.de', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        console.log('⏳ Waiting for page to fully load...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Try multiple selectors for cookie acceptance
        const cookieSelectors = [
            'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
            'button[class*="accept-all"]',
            'button[id*="accept-all"]',
            'button:has-text("Alle akzeptieren")',
            'button:has-text("Alle Cookies akzeptieren")',
            'button:has-text("Akzeptieren")',
            // Add selector for the exact text we see in the modal
            'button:contains("Alle Cookies akzeptieren")'
        ];
        
        let cookieAccepted = false;
        
        for (const selector of cookieSelectors) {
            try {
                console.log(`🔍 Checking for cookie button: ${selector}`);
                
                // Check if selector exists
                const button = await page.$(selector);
                if (button) {
                    console.log(`✅ Found cookie button with selector: ${selector}`);
                    
                    // Click the button
                    await page.click(selector);
                    console.log('🖱️  Clicked cookie accept button');
                    
                    // Wait for modal to disappear
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    cookieAccepted = true;
                    break;
                }
            } catch (error) {
                // Try next selector
                continue;
            }
        }
        
        if (!cookieAccepted) {
            // Try a more aggressive approach - look for any button containing "accept" text
            console.log('🔍 Trying alternative cookie acceptance method...');
            
            const acceptButtons = await page.$$eval('button', buttons => {
                return buttons
                    .filter(btn => {
                        const text = btn.textContent.trim();
                        // Look for exact match first
                        return text === 'Alle Cookies akzeptieren' ||
                               text.toLowerCase().includes('akzeptieren') || 
                               text.toLowerCase().includes('alle') || 
                               text.toLowerCase().includes('accept');
                    })
                    .map(btn => ({
                        text: btn.textContent.trim(),
                        classes: btn.className,
                        id: btn.id,
                        testId: btn.getAttribute('data-testid'),
                        onclick: btn.getAttribute('onclick')
                    }));
            });
            
            if (acceptButtons.length > 0) {
                console.log('📋 Found potential accept buttons:', acceptButtons);
                
                // Click the first one that looks like "accept all"
                for (const btnInfo of acceptButtons) {
                    // Prioritize exact match for "Alle Cookies akzeptieren"
                    if (btnInfo.text === 'Alle Cookies akzeptieren' || 
                        (btnInfo.text.toLowerCase().includes('alle') && btnInfo.text.toLowerCase().includes('akzeptieren'))) {
                        
                        console.log(`🎯 Attempting to click button: "${btnInfo.text}"`);
                        
                        const clicked = await page.evaluate((buttonText) => {
                            // Find button by exact text content
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const targetButton = buttons.find(btn => btn.textContent.trim() === buttonText);
                            
                            if (targetButton) {
                                targetButton.click();
                                return true;
                            }
                            return false;
                        }, btnInfo.text);
                        
                        if (clicked) {
                            console.log('✅ Successfully clicked cookie accept button');
                            cookieAccepted = true;
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            break;
                        }
                    }
                }
            }
        }
        
        if (cookieAccepted) {
            // Save marker file
            fs.writeFileSync(cookieFile, 'true');
            console.log('✅ Cookie acceptance completed and saved');
            
            // Navigate to a job detail page to ensure cookies work
            console.log('🧪 Testing cookie persistence...');
            await page.goto('https://www.arbeitsagentur.de/jobsuche/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if cookie modal appears again
            const modalAppeared = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            if (!modalAppeared) {
                console.log('✅ Cookies are working correctly - no modal on navigation');
            } else {
                console.log('⚠️  Cookie modal appeared again - cookies may not be persisting');
            }
        } else {
            console.log('❌ Could not find cookie acceptance button');
            console.log('📸 Taking screenshot for debugging...');
            await page.screenshot({ path: 'cookie-debug.png' });
            console.log('Screenshot saved to cookie-debug.png');
        }
        
        console.log('\n📊 Summary:');
        console.log(`- User data directory: ${userDataDir}`);
        console.log(`- Cookie marker file: ${cookieFile}`);
        console.log(`- Cookie accepted: ${cookieAccepted}`);
        
        console.log('\n💡 Next steps:');
        console.log('1. Close any existing scrapers');
        console.log('2. Run this script to accept cookies');
        console.log('3. Restart your scrapers');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (browser) {
            console.log('\n🔄 Keeping browser open for 10 seconds to inspect...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await browser.close();
        }
    }
}

// Run the fix
fixCookieAcceptance().catch(console.error);