#!/usr/bin/env node

/**
 * Browser Window Checker
 * 
 * This script checks how many Chrome browser windows are currently open
 * and provides detailed information about browser processes.
 */

const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

class BrowserWindowChecker {
    constructor() {
        console.log('🔍 Browser Window Checker');
        console.log('========================');
    }

    /**
     * Count Chrome browser processes
     */
    countChromeProcesses() {
        try {
            const result = execSync('ps aux | grep "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" | grep -v grep | wc -l', { encoding: 'utf8' });
            return parseInt(result.trim());
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get detailed Chrome process information
     */
    getChromeProcessDetails() {
        try {
            const result = execSync('ps aux | grep "Google Chrome for Testing" | grep -v grep', { encoding: 'utf8' });
            return result.trim().split('\n').filter(line => line.length > 0);
        } catch (error) {
            return [];
        }
    }

    /**
     * Check if port 9222 is in use
     */
    async checkPort9222() {
        try {
            const response = await fetch('http://localhost:9222/json');
            if (response.ok) {
                const data = await response.json();
                return { available: true, pages: data.length };
            }
        } catch (error) {
            return { available: false, error: error.message };
        }
    }

    /**
     * Try to connect to existing browser via Puppeteer
     */
    async tryPuppeteerConnection() {
        try {
            const browser = await puppeteer.connect({
                browserURL: 'http://localhost:9222',
                defaultViewport: null
            });
            
            const pages = await browser.pages();
            const version = await browser.version();
            
            // Don't close the browser, just disconnect
            browser.disconnect();
            
            return { 
                success: true, 
                pages: pages.length, 
                version: version 
            };
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    /**
     * Count processes using different patterns
     */
    countProcessesDetailed() {
        const patterns = [
            'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
            'Google Chrome for Testing',
            'remote-debugging-port=9222',
            'puppeteer_dev_chrome_profile'
        ];

        const counts = {};
        
        patterns.forEach(pattern => {
            try {
                const result = execSync(`ps aux | grep "${pattern}" | grep -v grep | wc -l`, { encoding: 'utf8' });
                counts[pattern] = parseInt(result.trim());
            } catch (error) {
                counts[pattern] = 0;
            }
        });

        return counts;
    }

    /**
     * Run comprehensive browser check
     */
    async runCheck() {
        console.log('📊 Process Count Analysis:');
        console.log('=========================');
        
        const mainProcesses = this.countChromeProcesses();
        console.log(`Main Chrome processes: ${mainProcesses}`);
        
        const detailedCounts = this.countProcessesDetailed();
        Object.entries(detailedCounts).forEach(([pattern, count]) => {
            console.log(`"${pattern}": ${count}`);
        });

        console.log('\n🔍 Process Details:');
        console.log('==================');
        const processDetails = this.getChromeProcessDetails();
        if (processDetails.length === 0) {
            console.log('No Chrome processes found');
        } else {
            processDetails.forEach((process, index) => {
                console.log(`${index + 1}. ${process.substring(0, 150)}...`);
            });
        }

        console.log('\n🌐 Port 9222 Check:');
        console.log('==================');
        const portCheck = await this.checkPort9222();
        if (portCheck.available) {
            console.log(`✅ Port 9222 is available with ${portCheck.pages} pages`);
        } else {
            console.log(`❌ Port 9222 not available: ${portCheck.error}`);
        }

        console.log('\n🤖 Puppeteer Connection Test:');
        console.log('=============================');
        const puppeteerTest = await this.tryPuppeteerConnection();
        if (puppeteerTest.success) {
            console.log(`✅ Puppeteer can connect successfully`);
            console.log(`   Pages: ${puppeteerTest.pages}`);
            console.log(`   Version: ${puppeteerTest.version}`);
        } else {
            console.log(`❌ Puppeteer connection failed: ${puppeteerTest.error}`);
        }

        console.log('\n💡 Recommendations:');
        console.log('===================');
        if (mainProcesses === 0) {
            console.log('No browser processes - safe to launch new browser');
        } else if (mainProcesses === 1) {
            if (puppeteerTest.success) {
                console.log('✅ Perfect! One browser running and Puppeteer can connect');
            } else {
                console.log('⚠️ One browser running but Puppeteer cannot connect - may need restart');
            }
        } else {
            console.log(`⚠️ ${mainProcesses} browser processes running - cleanup recommended`);
            console.log('   Run: pkill -f "Google Chrome for Testing"');
        }
    }
}

// Run the checker
async function main() {
    const checker = new BrowserWindowChecker();
    await checker.runCheck();
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = BrowserWindowChecker;