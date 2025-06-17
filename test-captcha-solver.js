#!/usr/bin/env node

/**
 * Test script for Independent CAPTCHA Solver
 * 
 * This script tests the new independent CAPTCHA solving functionality
 * without the need for the Odoo endpoint dependency.
 * 
 * Usage:
 *   node test-captcha-solver.js
 *   node test-captcha-solver.js --test-balance
 *   node test-captcha-solver.js --test-with-image <path>
 */

const IndependentCaptchaSolver = require('./src/independent-captcha-solver');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log('🧪 Testing Independent CAPTCHA Solver');
    console.log('=====================================\n');

    // Initialize solver
    const solver = new IndependentCaptchaSolver();
    
    // Show configuration
    console.log('📋 Configuration:');
    console.log(JSON.stringify(solver.getStats(), null, 2));
    console.log();

    const args = process.argv.slice(2);
    
    try {
        if (args.includes('--test-balance')) {
            await testBalance(solver);
        } else if (args.includes('--test-with-image')) {
            const imagePath = args[args.indexOf('--test-with-image') + 1];
            if (imagePath && fs.existsSync(imagePath)) {
                await testWithImage(solver, imagePath);
            } else {
                console.error('❌ Image file not found or not specified');
                console.log('Usage: node test-captcha-solver.js --test-with-image <path>');
                process.exit(1);
            }
        } else {
            // Default test - check connection and balance
            await runBasicTests(solver);
        }
        
    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        process.exit(1);
    }
}

async function runBasicTests(solver) {
    console.log('🔧 Running basic connectivity tests...\n');
    
    // Test 1: Basic connection and configuration test
    console.log('Test 1: Configuration and Connection');
    console.log('-----------------------------------');
    const testResult = await solver.test();
    
    if (testResult.success) {
        console.log('✅ Configuration test passed');
        console.log(`💰 Account balance: $${testResult.balance}`);
        console.log('📊 Configuration details:');
        console.log(JSON.stringify(testResult.configuration, null, 2));
    } else {
        console.log('❌ Configuration test failed:', testResult.error);
        if (testResult.details) {
            console.log('   Details:', testResult.details);
        }
        return;
    }
    
    console.log('\n🎉 Basic tests completed successfully!');
    console.log('\nTo test with an actual CAPTCHA image:');
    console.log('  node test-captcha-solver.js --test-with-image /path/to/captcha.jpg');
    console.log('\nTo check account balance only:');
    console.log('  node test-captcha-solver.js --test-balance');
}

async function testBalance(solver) {
    console.log('💰 Testing account balance...\n');
    
    const balanceResult = await solver.getBalance();
    
    if (balanceResult.success) {
        console.log(`✅ Current balance: $${balanceResult.balance}`);
        
        if (balanceResult.balance < 1.0) {
            console.log('⚠️  Warning: Low balance detected');
            console.log('   Consider adding funds to your 2Captcha account');
        } else {
            console.log('✅ Balance is sufficient for testing');
        }
    } else {
        console.log('❌ Failed to get balance:', balanceResult.error);
    }
}

async function testWithImage(solver, imagePath) {
    console.log(`📸 Testing with actual CAPTCHA image: ${imagePath}\n`);
    
    // First check if file exists and is readable
    try {
        const stats = fs.statSync(imagePath);
        console.log(`📁 File size: ${stats.size} bytes`);
        console.log(`📅 File modified: ${stats.mtime}`);
    } catch (error) {
        console.error('❌ Cannot access file:', error.message);
        return;
    }
    
    // Test solving the CAPTCHA
    console.log('🧩 Attempting to solve CAPTCHA...');
    const startTime = Date.now();
    
    const result = await solver.solveCaptchaFromFile(imagePath);
    const duration = Date.now() - startTime;
    
    if (result.success) {
        console.log(`✅ CAPTCHA solved successfully!`);
        console.log(`   Solution: "${result.solution}"`);
        console.log(`   CAPTCHA ID: ${result.captchaId}`);
        console.log(`   Duration: ${result.duration}ms (total: ${duration}ms)`);
        console.log(`   Attempt: ${result.attempt}/${solver.maxRetries}`);
        
        // Ask user to verify the solution
        console.log('\n🤔 Please verify if this solution looks correct for the CAPTCHA image.');
        console.log('   If incorrect, we can report it to improve accuracy.');
        
    } else {
        console.log(`❌ CAPTCHA solving failed`);
        console.log(`   Error: ${result.error}`);
        console.log(`   Duration: ${result.duration || duration}ms`);
        if (result.attempts) {
            console.log(`   Attempts made: ${result.attempts}`);
        }
    }
}

function showUsage() {
    console.log('Usage:');
    console.log('  node test-captcha-solver.js                           # Basic connectivity test');
    console.log('  node test-captcha-solver.js --test-balance            # Check account balance');
    console.log('  node test-captcha-solver.js --test-with-image <path>  # Test with actual image');
    console.log();
    console.log('Environment variables:');
    console.log('  CAPTCHA_API_KEY    - Your 2Captcha API key');
    console.log('  CAPTCHA_SAVE_DIR   - Directory to save debug images');
    console.log('  CAPTCHA_SAVE_IMAGES - Set to "true" to save images for debugging');
}

// Handle help requests
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
}

// Run the main function
main().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
});