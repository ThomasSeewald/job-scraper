const puppeteer = require('puppeteer');

async function testCookieModal() {
    let browser;
    try {
        console.log('🚀 Testing cookie modal detection...\n');
        
        browser = await puppeteer.launch({
            headless: false, // Visible browser to see what happens
            defaultViewport: null
        });

        const page = await browser.newPage();
        
        // Add event listener to detect when cookie modal appears
        await page.evaluateOnNewDocument(() => {
            const observer = new MutationObserver((mutations) => {
                const cookieButton = document.querySelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                if (cookieButton) {
                    console.log('🍪 COOKIE MODAL DETECTED!');
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });

        // Navigate to a job detail page
        console.log('📍 Navigating to job detail page...');
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1001484496-S', {
            waitUntil: 'domcontentloaded'
        });

        // Wait and check for cookie modal
        console.log('⏳ Waiting for page to fully load...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check if cookie button exists
        const cookieButton = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
        
        if (cookieButton) {
            console.log('✅ Cookie modal found!');
            console.log('🔘 Clicking cookie accept button...');
            
            await page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log('✅ Cookies accepted');
        } else {
            console.log('❌ No cookie modal found');
        }

        // Try navigating to another page to see if cookies persist
        console.log('\n📍 Navigating to another job...');
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1001483323-S', {
            waitUntil: 'domcontentloaded'
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const cookieButton2 = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
        console.log(cookieButton2 ? '⚠️ Cookie modal appeared again!' : '✅ No cookie modal on second page');

        console.log('\n📊 Test complete. Keeping browser open for 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

testCookieModal();