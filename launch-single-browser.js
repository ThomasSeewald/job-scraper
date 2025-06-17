#!/usr/bin/env node

/**
 * Launch Single Browser with Multiple Windows
 * 
 * This script launches ONE browser with multiple tabs/windows and then manages them
 */

const puppeteer = require('puppeteer');

async function launchSingleBrowserWithWindows() {
    console.log('🚀 Launching single browser with multiple windows...');
    
    let browser = null;
    
    try {
        // Launch ONE browser with debugging port
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: '/tmp/puppeteer-single-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--remote-debugging-port=9222'
            ]
        });
        
        console.log('✅ Browser launched');
        
        // Create multiple pages/windows
        console.log('📄 Creating multiple pages...');
        const page1 = (await browser.pages())[0]; // Default page
        const page2 = await browser.newPage();
        const page3 = await browser.newPage();
        
        // Set different content for each page
        await page1.setContent('<h1>Page 1 - Main</h1><p>This is the main page</p>');
        await page2.setContent('<h1>Page 2 - Secondary</h1><p>This is the secondary page</p>');
        await page3.setContent('<h1>Page 3 - Third</h1><p>This is the third page</p>');
        
        console.log('✅ Created 3 pages in single browser');
        
        // Verify debugging port
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
            const response = await fetch('http://localhost:9222/json');
            if (response.ok) {
                const data = await response.json();
                console.log(`✅ Port 9222 accessible with ${data.length} pages`);
            }
        } catch (error) {
            console.log('❌ Port 9222 not accessible:', error.message);
        }
        
        console.log('\n🔧 Now managing windows...');
        
        // Now manage the windows - close all but one and get data
        const allPages = await browser.pages();
        console.log(`📊 Found ${allPages.length} pages`);
        
        if (allPages.length > 1) {
            console.log(`🗑️ Closing ${allPages.length - 1} extra pages...`);
            
            // Close all pages except the first one
            for (let i = 1; i < allPages.length; i++) {
                console.log(`   Closing page ${i + 1}...`);
                await allPages[i].close();
            }
            
            console.log('✅ Extra pages closed');
        }
        
        // Get data from the remaining page
        const remainingPages = await browser.pages();
        console.log(`📊 Remaining pages: ${remainingPages.length}`);
        
        if (remainingPages.length > 0) {
            const mainPage = remainingPages[0];
            
            console.log('\n📋 Data from remaining window:');
            console.log('==============================');
            
            // Get page information
            const url = mainPage.url();
            const title = await mainPage.title();
            const content = await mainPage.content();
            
            console.log(`URL: ${url}`);
            console.log(`Title: ${title}`);
            console.log(`Content length: ${content.length} characters`);
            console.log(`Content preview: ${content.substring(0, 200)}...`);
            
            // Set content to "Test"
            console.log('\n📝 Setting content to "Test"...');
            await mainPage.setContent(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Test Page - Single Browser</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
                            color: white;
                        }
                        .test-content {
                            font-size: 72px;
                            font-weight: bold;
                            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
                            margin-bottom: 20px;
                        }
                        .info {
                            background: rgba(255,255,255,0.1);
                            padding: 20px;
                            border-radius: 10px;
                            backdrop-filter: blur(10px);
                            text-align: center;
                        }
                    </style>
                </head>
                <body>
                    <div class="test-content">Test</div>
                    <div class="info">
                        <h3>Browser Status</h3>
                        <p>Port: 9222 ✅</p>
                        <p>Windows: 1 ✅</p>
                        <p>Time: ${new Date().toLocaleString()}</p>
                        <p>Ready for job scraping! 🚀</p>
                    </div>
                </body>
                </html>
            `);
            
            console.log('✅ Content set to "Test"');
            
            // Get final page data
            console.log('\n📋 Final page data:');
            console.log('===================');
            const finalUrl = mainPage.url();
            const finalTitle = await mainPage.title();
            
            console.log(`Final URL: ${finalUrl}`);
            console.log(`Final Title: ${finalTitle}`);
        }
        
        console.log('\n💡 Success Summary:');
        console.log('==================');
        console.log('✅ Single browser running on port 9222');
        console.log('✅ Only 1 window/page remains open');
        console.log('✅ Content set to "Test"');
        console.log('✅ Browser ready for reuse');
        console.log('\n🔗 Browser debugging: http://localhost:9222');
        
        // Leave browser open - disconnect, don't close
        browser.disconnect();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (browser) {
            await browser.close();
        }
    }
}

// Run the script
launchSingleBrowserWithWindows().catch(console.error);