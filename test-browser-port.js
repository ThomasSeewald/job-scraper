#!/usr/bin/env node

/**
 * Test Browser Port Configuration
 * 
 * This script tests launching a browser with a fixed port and verifies it works
 */

const puppeteer = require('puppeteer');

async function testBrowserPort() {
    console.log('🧪 Testing browser launch with fixed port 9222...');
    
    let browser = null;
    
    try {
        // First kill any existing browsers
        const { execSync } = require('child_process');
        try {
            execSync('pkill -f "Google Chrome for Testing"', { stdio: 'ignore' });
            console.log('🧹 Cleaned up existing browsers');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.log('ℹ️ No existing browsers to clean up');
        }
        
        // Launch browser with explicit port
        console.log('🚀 Launching browser with port 9222...');
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: '/tmp/puppeteer-test-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--remote-debugging-port=9222'
            ]
        });
        
        console.log('✅ Browser launched successfully');
        
        // Check if port is available
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
            const response = await fetch('http://localhost:9222/json');
            if (response.ok) {
                const data = await response.json();
                console.log(`✅ Port 9222 is accessible with ${data.length} pages`);
            }
        } catch (error) {
            console.log('❌ Port 9222 is not accessible:', error.message);
        }
        
        // Test connecting to the browser
        try {
            const connectedBrowser = await puppeteer.connect({
                browserURL: 'http://localhost:9222',
                defaultViewport: null
            });
            
            const pages = await connectedBrowser.pages();
            console.log(`✅ Puppeteer can connect! Found ${pages.length} pages`);
            
            // Disconnect (don't close)
            connectedBrowser.disconnect();
            
        } catch (error) {
            console.log('❌ Puppeteer connection failed:', error.message);
        }
        
        console.log('\n🔍 Verifying process is using port 9222...');
        try {
            const result = execSync('ps aux | grep "remote-debugging-port=9222" | grep -v grep', { encoding: 'utf8' });
            if (result.trim()) {
                console.log('✅ Process is using port 9222');
                console.log('Process details:', result.trim().substring(0, 150) + '...');
            } else {
                console.log('❌ No process found using port 9222');
            }
        } catch (error) {
            console.log('❌ No process found using port 9222');
        }
        
        console.log('\n💡 Browser is ready for reuse!');
        console.log('   - Port 9222 should be accessible');
        console.log('   - Run this script again to test connection');
        console.log('   - Browser will stay open for testing');
        
        // Don't close the browser - leave it open for testing
        console.log('\n⏸️ Browser left open for testing. Close manually when done.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (browser) {
            await browser.close();
        }
    }
}

// Run the test
testBrowserPort().catch(console.error);