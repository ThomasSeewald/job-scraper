const { spawn } = require('child_process');
const path = require('path');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startDetailScrapers() {
    console.log('🚀 Starting job detail scrapers with delays...');
    
    const scraperPath = path.join(__dirname, 'src', 'newest-jobs-scraper.js');
    
    // Start 3 scrapers with 2-minute delays
    for (let i = 1; i <= 3; i++) {
        console.log(`\n📌 Starting detail scraper ${i}`);
        
        // Start the scraper with 5000 jobs per batch
        const childProcess = spawn('node', [scraperPath, '5000'], {
            env: {
                ...process.env,
                NODE_ENV: 'production'
            },
            stdio: 'inherit' // Show output in console
        });
        
        console.log(`✅ Detail scraper ${i} started (PID: ${childProcess.pid})`);
        
        // Wait 2 minutes before starting the next one  
        if (i < 3) {
            console.log(`⏳ Waiting 120 seconds before starting scraper ${i + 1}...`);
            await delay(120000); // 120 seconds
        }
    }
    
    console.log('\n✅ All 3 detail scrapers started');
    console.log('📊 Each scraper will process up to 5000 jobs');
    console.log('🍪 Cookie handling and CAPTCHA detection included');
    console.log('📋 These scrapers update the job_scrp_job_details table');
    console.log('🖥️ Watch the dashboard at http://localhost:3001 for progress');
    console.log('\n⚠️  Note: With 114,754 jobs to process, this will take several days');
}

startDetailScrapers().catch(console.error);