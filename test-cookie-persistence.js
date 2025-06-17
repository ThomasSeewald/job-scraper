const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function testCookiePersistence() {
    console.log('🧪 Testing cookie persistence...\n');
    
    const userDataDir = path.join(os.homedir(), '.job-scraper-cookies-test');
    console.log(`📁 User data directory: ${userDataDir}`);
    
    // First browser session
    console.log('\n1️⃣ FIRST BROWSER SESSION');
    let browser = await puppeteer.launch({
        headless: false,
        userDataDir: userDataDir,
        defaultViewport: null
    });
    
    let page = await browser.newPage();
    
    console.log('📍 Navigating to arbeitsagentur.de...');
    await page.goto('https://www.arbeitsagentur.de', { waitUntil: 'domcontentloaded' });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check for cookie button
    const cookieButton = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
    
    if (cookieButton) {
        console.log('🍪 Cookie modal found! Clicking accept...');
        await page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('✅ Cookies accepted');
    } else {
        console.log('ℹ️ No cookie modal found');
    }
    
    // Navigate to a job detail page
    console.log('\n📍 Navigating to job detail page...');
    await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1202719721-S', { 
        waitUntil: 'domcontentloaded' 
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if cookie modal appears again
    const cookieButton2 = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
    console.log(cookieButton2 ? '❌ Cookie modal appeared again!' : '✅ No cookie modal on job page');
    
    console.log('\n🔄 Closing first browser...');
    await browser.close();
    
    // Second browser session
    console.log('\n2️⃣ SECOND BROWSER SESSION (testing persistence)');
    browser = await puppeteer.launch({
        headless: false,
        userDataDir: userDataDir,
        defaultViewport: null
    });
    
    page = await browser.newPage();
    
    console.log('📍 Navigating directly to job detail page...');
    await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1202698540-S', { 
        waitUntil: 'domcontentloaded' 
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if cookie modal appears
    const cookieButton3 = await page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
    console.log(cookieButton3 ? '❌ Cookie modal appeared in new session!' : '✅ Cookies persisted! No modal');
    
    console.log('\n⏳ Keeping browser open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    await browser.close();
    console.log('\n✅ Test complete');
}

testCookiePersistence().catch(console.error);