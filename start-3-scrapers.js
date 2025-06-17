const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Start 3 batch-employer-scraper processes directly
console.log('🚀 Starting 3 batch-employer-scraper processes...');

// Make sure temp batch files exist from previous run
const batchFiles = [
    'temp_batch_1.json',
    'temp_batch_2.json', 
    'temp_batch_3.json'
];

// Check if batch files exist
for (let i = 0; i < 3; i++) {
    const batchFile = path.join(__dirname, batchFiles[i]);
    if (!fs.existsSync(batchFile)) {
        console.error(`❌ Batch file not found: ${batchFile}`);
        console.error('Please run parallel-historical-scraper.js first to generate batch files');
        process.exit(1);
    }
}

// Start 3 processes with delays
const processes = [];
const processDelay = 5000; // 5 seconds between each process start

async function startProcess(processId) {
    console.log(`\n🔄 Starting process ${processId}/3...`);
    
    const args = [
        path.join(__dirname, 'src/batch-employer-scraper.js'),
        path.join(__dirname, batchFiles[processId - 1]),
        '--process-id', processId.toString()
    ];

    const child = spawn('node', args, {
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            HEADLESS_MODE: 'false',  // Visible browser windows
            PROCESS_ID: processId.toString(),
            PARALLEL_MODE: 'true'
        }
    });

    child.unref();
    processes.push(child);
    
    console.log(`✅ Process ${processId} started (PID: ${child.pid})`);
    console.log(`📁 Using batch file: ${batchFiles[processId - 1]}`);
}

async function startAllProcesses() {
    for (let i = 1; i <= 3; i++) {
        await startProcess(i);
        
        if (i < 3) {
            console.log(`⏳ Waiting ${processDelay/1000} seconds before starting next process...`);
            await new Promise(resolve => setTimeout(resolve, processDelay));
        }
    }
    
    console.log('\n✅ All 3 processes started as background jobs');
    console.log('📊 Monitor progress in: logs/parallel-historical-scraper.log');
    console.log('🖥️ Browser windows should be visible');
    console.log('\nTo stop all processes: pkill -f batch-employer-scraper');
}

startAllProcesses().catch(console.error);