const { spawn } = require('child_process');

// Start the parallel historical scraper in non-headless mode
console.log('🚀 Starting scrapers in visible mode...');

const scraperProcess = spawn('node', ['src/parallel-historical-scraper.js', 'start'], {
    env: {
        ...process.env,
        HEADLESS_MODE: 'false',  // Force non-headless mode
        NODE_ENV: 'production'
    },
    stdio: 'inherit'
});

console.log(`✅ Started parallel scraper coordinator (PID: ${scraperProcess.pid})`);
console.log('👀 Browser windows will be visible');
console.log('🔍 You can watch the CAPTCHA solving process');

// Keep the script running
scraperProcess.on('exit', (code) => {
    console.log(`Process exited with code ${code}`);
});