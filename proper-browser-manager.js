#!/usr/bin/env node

/**
 * Proper Browser Manager using Remote Debugging
 * 
 * Based on ChatGPT guidance - uses remote debugging to properly manage browser sessions
 */

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

class ProperBrowserManager {
    constructor() {
        this.browserURL = 'http://localhost:9222';
        this.userDataDir = '/tmp/puppeteer-persistent';
    }

    /**
     * Launch Chrome with remote debugging (independent process)
     */
    async launchChromeWithDebugging() {
        console.log('🚀 Launching Chrome with remote debugging...');
        
        try {
            // Kill any existing Chrome processes first
            execSync('pkill -f "Google Chrome for Testing"', { stdio: 'ignore' });
            console.log('🧹 Cleaned up existing browsers');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            // No existing processes to kill
        }
        
        // Launch Chrome directly with remote debugging
        const chrome = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: this.userDataDir,
            args: [
                '--remote-debugging-port=9222',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        // Create initial pages to simulate multiple windows
        const initialPage = (await chrome.pages())[0];
        const page2 = await chrome.newPage();
        const page3 = await chrome.newPage();
        
        // Set content for each page
        await initialPage.setContent('<h1>Window 1</h1><p>First window content</p>');
        await page2.setContent('<h1>Window 2</h1><p>Second window content</p>');  
        await page3.setContent('<h1>Window 3</h1><p>Third window content</p>');
        
        console.log('✅ Chrome launched with 3 windows');
        
        // Disconnect from this Puppeteer instance (but keep Chrome running)
        chrome.disconnect();
        
        return true;
    }

    /**
     * Connect to existing Chrome via remote debugging
     */
    async connectToChrome() {
        try {
            const browser = await puppeteer.connect({
                browserURL: this.browserURL,
                defaultViewport: null
            });
            
            console.log('✅ Connected to existing Chrome browser');
            return browser;
        } catch (error) {
            console.log('❌ Cannot connect to Chrome:', error.message);
            return null;
        }
    }

    /**
     * Check and manage browser windows
     */
    async checkAndManageWindows() {
        console.log('\n🔍 Checking browser windows...');
        
        const browser = await this.connectToChrome();
        if (!browser) {
            console.log('❌ No browser available');
            return;
        }
        
        try {
            const pages = await browser.pages();
            console.log(`📊 Found ${pages.length} browser windows/pages`);
            
            // Show data from each page before closing
            console.log('\n📋 Data from all windows:');
            console.log('========================');
            
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const url = page.url();
                const title = await page.title();
                
                console.log(`Window ${i + 1}:`);
                console.log(`   URL: ${url}`);
                console.log(`   Title: ${title}`);
            }
            
            // Close all windows except the first one
            if (pages.length > 1) {
                console.log(`\n🗑️ Closing ${pages.length - 1} extra windows...`);
                
                for (let i = 1; i < pages.length; i++) {
                    console.log(`   Closing window ${i + 1}...`);
                    await pages[i].close();
                }
                
                console.log('✅ Extra windows closed');
            }
            
            // Get data from remaining window and set content to "Test"
            const remainingPages = await browser.pages();
            if (remainingPages.length > 0) {
                const mainPage = remainingPages[0];
                
                console.log('\n📋 Remaining window data:');
                console.log('========================');
                const url = mainPage.url();
                const title = await mainPage.title();
                const content = await mainPage.content();
                
                console.log(`URL: ${url}`);
                console.log(`Title: ${title}`);
                console.log(`Content length: ${content.length} characters`);
                
                // Set content to "Test"
                console.log('\n📝 Setting content to "Test"...');
                await mainPage.setContent(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Test - Browser Managed</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                text-align: center;
                            }
                            .test-content {
                                font-size: 96px;
                                font-weight: bold;
                                text-shadow: 3px 3px 6px rgba(0,0,0,0.5);
                                margin-bottom: 30px;
                                border: 5px solid white;
                                padding: 30px;
                                border-radius: 20px;
                                background: rgba(255,255,255,0.1);
                                backdrop-filter: blur(10px);
                            }
                            .status {
                                background: rgba(255,255,255,0.2);
                                padding: 20px;
                                border-radius: 15px;
                                backdrop-filter: blur(10px);
                            }
                        </style>
                    </head>
                    <body>
                        <div class="test-content">Test</div>
                        <div class="status">
                            <h2>✅ Browser Properly Managed</h2>
                            <p>🌐 Remote debugging on port 9222</p>
                            <p>📄 Single window remaining</p>
                            <p>🕒 ${new Date().toLocaleString()}</p>
                            <p>🚀 Ready for job scraping!</p>
                        </div>
                    </body>
                    </html>
                `);
                
                console.log('✅ Content set to "Test"');
                
                // Get final data
                const finalUrl = mainPage.url();
                const finalTitle = await mainPage.title();
                
                console.log(`\n📋 Final window data:`);
                console.log(`   URL: ${finalUrl}`);
                console.log(`   Title: ${finalTitle}`);
            }
            
            // Disconnect (keep browser running)
            browser.disconnect();
            
            console.log('\n💡 Success! Browser managed properly');
            console.log('   - Only 1 window remains');
            console.log('   - Content set to "Test"');
            console.log('   - Browser stays alive for reuse');
            
        } catch (error) {
            console.error('❌ Error managing windows:', error.message);
            browser.disconnect();
        }
    }

    /**
     * Run complete browser management workflow
     */
    async run() {
        console.log('🔧 Proper Browser Manager');
        console.log('=========================');
        
        // First check if browser is already running
        let browser = await this.connectToChrome();
        
        if (!browser) {
            console.log('📱 No browser running, launching new one...');
            await this.launchChromeWithDebugging();
            
            // Wait for browser to be ready
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log('♻️ Browser already running, will manage existing windows');
            browser.disconnect();
        }
        
        // Now manage the windows
        await this.checkAndManageWindows();
    }
}

// Run the manager
async function main() {
    const manager = new ProperBrowserManager();
    await manager.run();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ProperBrowserManager;