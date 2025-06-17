/**
 * Test parallel processing with isolated user data directories
 * This should solve the CAPTCHA sharing issue
 */

const ParallelHistoricalScraper = require('./src/parallel-historical-scraper');

async function testParallelIsolated() {
    console.log('🧪 Testing Parallel Processing with Isolated User Data Directories');
    console.log('💡 Each process now uses unique userDataDir to prevent cookie sharing');
    console.log('🎯 Expected: Only first page of each process should need CAPTCHA, then ~19 free pages');
    console.log('');
    
    const scraper = new ParallelHistoricalScraper();
    
    try {
        console.log('🚀 Starting parallel processes with isolated sessions...');
        console.log('📊 This will process 5 batches of employers in parallel');
        console.log('🔍 Monitor the logs to see CAPTCHA frequency per process');
        
        await scraper.startParallelProcesses();
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Add monitoring function
function monitorCaptchaFrequency() {
    console.log('📊 CAPTCHA Frequency Monitor Started');
    console.log('🔍 Watching for CAPTCHA patterns in parallel processes...');
    console.log('');
    
    const { spawn } = require('child_process');
    
    // Monitor the log file for CAPTCHA patterns
    const tailProcess = spawn('tail', ['-f', '/Users/thomassee/Docker/containers/job-scraper/logs/parallel-historical-scraper.log'], {
        stdio: 'pipe'
    });
    
    let captchaStats = {
        process1: { captchas: 0, pages: 0 },
        process2: { captchas: 0, pages: 0 },
        process3: { captchas: 0, pages: 0 },
        process4: { captchas: 0, pages: 0 },
        process5: { captchas: 0, pages: 0 }
    };
    
    tailProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        
        lines.forEach(line => {
            // Track CAPTCHA detections
            const captchaMatch = line.match(/\[P(\d+)\].*CAPTCHA detected.*CAPTCHA #(\d+)/);
            if (captchaMatch) {
                const processId = captchaMatch[1];
                const captchaNum = parseInt(captchaMatch[2]);
                
                if (captchaStats[`process${processId}`]) {
                    captchaStats[`process${processId}`].captchas = captchaNum;
                    
                    console.log(`🧩 Process ${processId}: CAPTCHA #${captchaNum} detected`);
                }
            }
            
            // Track page processing
            const pageMatch = line.match(/\[P(\d+)\].*Processing employer (\d+)/);
            if (pageMatch) {
                const processId = pageMatch[1];
                const employerNum = parseInt(pageMatch[2]);
                
                if (captchaStats[`process${processId}`]) {
                    captchaStats[`process${processId}`].pages = employerNum;
                }
            }
            
            // Show CAPTCHA frequency errors (these should not happen with isolated sessions)
            if (line.includes('CAPTCHA frequency error')) {
                console.log(`❌ CAPTCHA FREQUENCY ERROR: ${line}`);
            }
            
            // Show successful extractions
            if (line.includes('Domain extraction found')) {
                console.log(`📧 EMAIL SUCCESS: ${line}`);
            }
        });
    });
    
    // Show stats every 30 seconds
    setInterval(() => {
        console.log('\n📊 Current CAPTCHA Statistics:');
        Object.entries(captchaStats).forEach(([process, stats]) => {
            const processNum = process.replace('process', '');
            const ratio = stats.captchas > 0 ? (stats.pages / stats.captchas).toFixed(1) : 'N/A';
            console.log(`   Process ${processNum}: ${stats.pages} pages, ${stats.captchas} CAPTCHAs (${ratio} pages/CAPTCHA)`);
        });
        console.log('');
    }, 30000);
    
    return tailProcess;
}

// Main execution
async function main() {
    console.log('🚀 Starting Parallel Processing Test with Isolated Sessions');
    console.log('');
    
    // Start monitoring
    const monitor = monitorCaptchaFrequency();
    
    try {
        await testParallelIsolated();
        
        console.log('✅ Parallel processing test completed');
        console.log('🔍 Check the logs for CAPTCHA frequency patterns');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        // Clean up monitor
        if (monitor) {
            monitor.kill();
        }
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testParallelIsolated, monitorCaptchaFrequency };