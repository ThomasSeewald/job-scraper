#!/usr/bin/env node

// Suppress console logs
const originalLog = console.log;
console.log = () => {};

const IndependentCaptchaSolver = require('./src/independent-captcha-solver');

async function main() {
    const solver = new IndependentCaptchaSolver();
    const result = await solver.getBalance();
    
    // Restore console.log for our output
    console.log = originalLog;
    
    if (result.success) {
        console.log(`$${result.balance}`);
        process.exit(0);
    } else {
        console.error('ERROR:', result.error);
        process.exit(1);
    }
}

main().catch(error => {
    console.log = originalLog;
    console.error('ERROR:', error.message);
    process.exit(1);
});