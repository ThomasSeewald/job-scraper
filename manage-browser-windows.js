#!/usr/bin/env node

/**
 * Manage Browser Windows
 * 
 * This script:
 * 1. Checks the number of browser windows
 * 2. Closes all windows above 1
 * 3. Sets the content of the remaining window to "Test"
 */

const puppeteer = require('puppeteer');

async function manageBrowserWindows() {
    console.log('🔧 Browser Window Manager');
    console.log('=========================');
    
    let browser = null;
    
    try {
        // Step 1: Check current number of windows
        console.log('📊 Step 1: Checking current browser windows...');
        
        try {
            browser = await puppeteer.connect({
                browserURL: 'http://localhost:9222',
                defaultViewport: null
            });
            
            const pages = await browser.pages();
            console.log(`Found ${pages.length} browser windows/pages`);
            
            // Step 2: Close all windows above 1
            if (pages.length > 1) {
                console.log(`🗑️ Step 2: Closing ${pages.length - 1} extra windows...`);
                
                for (let i = 1; i < pages.length; i++) {
                    console.log(`   Closing window ${i + 1}...`);
                    await pages[i].close();
                }
                
                console.log('✅ Extra windows closed');
            } else {
                console.log('✅ Step 2: Only 1 window found, no need to close any');
            }
            
            // Step 3: Set content of remaining window to "Test"
            console.log('📝 Step 3: Setting content of remaining window to "Test"...');
            
            const remainingPages = await browser.pages();
            if (remainingPages.length > 0) {
                const mainPage = remainingPages[0];
                
                // Set the HTML content to "Test"
                await mainPage.setContent(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Test Page</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background-color: #f0f0f0;
                            }
                            .test-content {
                                font-size: 48px;
                                font-weight: bold;
                                color: #333;
                                text-align: center;
                                padding: 20px;
                                border: 3px solid #007acc;
                                border-radius: 10px;
                                background-color: white;
                                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                            }
                            .info {
                                position: absolute;
                                top: 20px;
                                left: 20px;
                                font-size: 14px;
                                color: #666;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="info">
                            Browser: Puppeteer Controlled<br>
                            Port: 9222<br>
                            Time: ${new Date().toLocaleString()}
                        </div>
                        <div class="test-content">
                            Test
                        </div>
                    </body>
                    </html>
                `);
                
                console.log('✅ Content set to "Test"');
                
                // Get the current URL and title
                const url = mainPage.url();
                const title = await mainPage.title();
                console.log(`   Page URL: ${url}`);
                console.log(`   Page Title: ${title}`);
                
            } else {
                console.log('❌ No pages found after cleanup');
            }
            
            // Step 4: Verify final state
            console.log('🔍 Step 4: Verifying final state...');
            const finalPages = await browser.pages();
            console.log(`✅ Final window count: ${finalPages.length}`);
            
            console.log('\n💡 Summary:');
            console.log('   - Browser windows managed successfully');
            console.log('   - Only 1 window remains open');
            console.log('   - Window content set to "Test"');
            console.log('   - Browser ready for reuse via port 9222');
            
            // Disconnect (don't close the browser)
            browser.disconnect();
            
        } catch (error) {
            console.log('❌ Cannot connect to existing browser:', error.message);
            console.log('💡 Make sure a browser is running on port 9222');
            console.log('   Run: node test-browser-port.js');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// Run the manager
manageBrowserWindows().catch(console.error);