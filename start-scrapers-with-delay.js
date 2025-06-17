const { spawn } = require('child_process');
const path = require('path');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startScrapersWithDelay() {
    console.log('🚀 Starting scrapers with 1-minute delays in non-headless mode...');
    
    const scraperPath = path.join(__dirname, 'src', 'batch-employer-scraper.js');
    
    for (let i = 1; i <= 5; i++) {
        const batchFile = path.join(__dirname, `temp_batch_${i}.json`);
        
        console.log(`\n📌 Starting scraper ${i} with batch: ${batchFile}`);
        
        // Start the scraper in non-headless mode
        const childProcess = spawn('node', [scraperPath, batchFile, '--process-id', i.toString()], {
            env: {
                ...process.env,
                PROCESS_ID: i.toString(),
                PARALLEL_MODE: 'true',
                HEADLESS_MODE: 'false', // Run in visible mode
                NODE_ENV: 'production'
            },
            stdio: 'inherit' // Show output in console
        });
        
        console.log(`✅ Scraper ${i} started (PID: ${childProcess.pid})`);
        
        // Wait 1 minute before starting the next one
        if (i < 5) {
            console.log(`⏳ Waiting 60 seconds before starting scraper ${i + 1}...`);
            await delay(60000); // 60 seconds
        }
    }
    
    console.log('\n✅ All scrapers started with 1-minute delays');
    console.log('📺 Running in non-headless mode - you should see browser windows');
    console.log('👀 Watch the console for CAPTCHA solving activity');
}

startScrapersWithDelay().catch(console.error);