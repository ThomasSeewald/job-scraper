#!/usr/bin/env node

/**
 * Balance Checker CLI
 * 
 * Command-line interface for 2Captcha balance monitoring and alerts
 * 
 * Usage:
 *   node balance-check.js                    # Check balance and send alert if needed
 *   node balance-check.js --check-only       # Check balance without sending alerts
 *   node balance-check.js --test-email       # Test email configuration
 *   node balance-check.js --send-test        # Send test email
 *   node balance-check.js --force-alert      # Force send alert regardless of balance
 *   node balance-check.js --status           # Show current status and configuration
 */

const BalanceMonitor = require('./src/balance-monitor');
const path = require('path');

// Load environment variables
require('dotenv').config();

async function main() {
    console.log('💰 2Captcha Balance Monitor');
    console.log('===========================\n');

    const monitor = new BalanceMonitor();
    const args = process.argv.slice(2);

    try {
        if (args.includes('--help') || args.includes('-h')) {
            showUsage();
            return;
        }

        if (args.includes('--status')) {
            await showStatus(monitor);
            return;
        }

        if (args.includes('--test-email')) {
            await testEmailConfig(monitor);
            return;
        }

        if (args.includes('--send-test')) {
            await sendTestEmail(monitor);
            return;
        }

        if (args.includes('--force-alert')) {
            await forceAlert(monitor);
            return;
        }

        if (args.includes('--check-only')) {
            await checkBalanceOnly(monitor);
            return;
        }

        // Default: Check balance and send alerts if needed
        await checkBalanceWithAlerts(monitor);

    } catch (error) {
        console.error('💥 Unexpected error:', error.message);
        process.exit(1);
    }
}

async function showStatus(monitor) {
    console.log('📊 Current Status and Configuration');
    console.log('----------------------------------\n');

    // Show configuration
    const solverStats = monitor.captchaSolver.getStats();
    console.log('🔧 Configuration:');
    console.log(`   Alert Threshold: $${monitor.alertThreshold}`);
    console.log(`   Alert Email: ${monitor.emailRecipient}`);
    console.log(`   API Key: ${solverStats.apiKey}`);
    console.log(`   SMTP Host: ${monitor.emailConfig.host}:${monitor.emailConfig.port}`);
    console.log(`   SMTP User: ${monitor.emailConfig.auth.user || 'Not configured'}`);
    console.log();

    // Get current state
    const state = await monitor.getState();
    if (state) {
        console.log('📈 Last Balance Check:');
        console.log(`   Balance: $${state.balance}`);
        console.log(`   Timestamp: ${new Date(state.timestamp).toLocaleString()}`);
        console.log(`   Below Threshold: ${state.belowThreshold ? 'YES ⚠️' : 'NO ✅'}`);
        console.log(`   Alert Sent: ${state.alertSent ? 'YES' : 'NO'}`);
        if (state.alertError) {
            console.log(`   Alert Error: ${state.alertError}`);
        }
        console.log();
    }

    // Get last alert
    const lastAlert = await monitor.getLastAlert();
    if (lastAlert) {
        const timeSince = Date.now() - new Date(lastAlert.timestamp).getTime();
        const hoursSince = (timeSince / (1000 * 60 * 60)).toFixed(1);
        
        console.log('📧 Last Alert Sent:');
        console.log(`   Timestamp: ${new Date(lastAlert.timestamp).toLocaleString()}`);
        console.log(`   Balance: $${lastAlert.balance}`);
        console.log(`   Time Since: ${hoursSince} hours ago`);
        console.log(`   Recipient: ${lastAlert.recipient}`);
        console.log();
    }

    // Test email config
    console.log('📧 Testing Email Configuration...');
    const emailTest = await monitor.testEmailConfig();
    if (emailTest.success) {
        console.log('✅ Email configuration is working');
    } else {
        console.log('❌ Email configuration failed:', emailTest.error);
        console.log('   Config:', JSON.stringify(emailTest.config, null, 2));
    }
}

async function testEmailConfig(monitor) {
    console.log('📧 Testing Email Configuration');
    console.log('-----------------------------\n');

    const result = await monitor.testEmailConfig();
    
    if (result.success) {
        console.log('✅ Email configuration test passed');
        console.log('   SMTP server connection successful');
        console.log('   Ready to send balance alerts');
    } else {
        console.log('❌ Email configuration test failed');
        console.log(`   Error: ${result.error}`);
        console.log('\n📋 Configuration Details:');
        console.log(JSON.stringify(result.config, null, 2));
        console.log('\n🔧 To fix email configuration:');
        console.log('   1. Set SMTP_USER (Gmail address)');
        console.log('   2. Set SMTP_PASS (Gmail App Password)');
        console.log('   3. Ensure 2-factor authentication is enabled on Gmail');
        console.log('   4. Generate App Password: https://myaccount.google.com/apppasswords');
    }
}

async function sendTestEmail(monitor) {
    console.log('📧 Sending Test Email');
    console.log('--------------------\n');

    // First test configuration
    const configTest = await monitor.testEmailConfig();
    if (!configTest.success) {
        console.log('❌ Email configuration failed, cannot send test email');
        console.log(`   Error: ${configTest.error}`);
        return;
    }

    console.log('✅ Email configuration verified, sending test email...');
    
    const result = await monitor.sendTestEmail();
    
    if (result.success) {
        console.log('✅ Test email sent successfully');
        console.log(`   Message ID: ${result.messageId}`);
        console.log(`   Recipient: ${result.recipient}`);
        console.log('\n📧 Check your email inbox for the test message');
    } else {
        console.log('❌ Failed to send test email');
        console.log(`   Error: ${result.error}`);
    }
}

async function forceAlert(monitor) {
    console.log('🚨 Forcing Balance Alert');
    console.log('-----------------------\n');

    // Get current balance first
    const balanceResult = await monitor.captchaSolver.getBalance();
    if (!balanceResult.success) {
        console.error('❌ Cannot get balance:', balanceResult.error);
        return;
    }

    console.log(`💰 Current balance: $${balanceResult.balance}`);
    console.log('📧 Sending forced alert email...');

    const emailResult = await monitor.sendBalanceAlert(balanceResult.balance);
    
    if (emailResult.success) {
        console.log('✅ Force alert sent successfully');
        console.log(`   Message ID: ${emailResult.messageId}`);
        console.log(`   Recipient: ${emailResult.recipient}`);
        
        // Record the alert
        await monitor.recordAlertSent(balanceResult.balance);
        console.log('📝 Alert recorded');
    } else {
        console.log('❌ Failed to send force alert');
        console.log(`   Error: ${emailResult.error}`);
    }
}

async function checkBalanceOnly(monitor) {
    console.log('💰 Checking Balance (No Alerts)');
    console.log('-------------------------------\n');

    const balanceResult = await monitor.captchaSolver.getBalance();
    
    if (balanceResult.success) {
        const balance = parseFloat(balanceResult.balance);
        console.log(`💰 Current balance: $${balance}`);
        console.log(`⚠️  Alert threshold: $${monitor.alertThreshold}`);
        
        if (balance < monitor.alertThreshold) {
            const deficit = monitor.alertThreshold - balance;
            console.log(`🚨 Status: BELOW THRESHOLD (need $${deficit.toFixed(2)} more)`);
            
            if (balance < 1.0) {
                console.log('🔴 CRITICAL: Balance is very low!');
            } else if (balance < 2.0) {
                console.log('🟠 WARNING: Balance is getting low');
            } else {
                console.log('🟡 CAUTION: Balance below alert threshold');
            }
        } else {
            console.log('✅ Status: SUFFICIENT');
            const buffer = balance - monitor.alertThreshold;
            console.log(`   Buffer above threshold: $${buffer.toFixed(2)}`);
        }
        
        // Estimate usage based on current balance
        const estimatedSolves = Math.floor(balance / 0.001); // Assuming ~$0.001 per solve
        console.log(`📊 Estimated remaining CAPTCHA solves: ~${estimatedSolves.toLocaleString()}`);
        
    } else {
        console.log('❌ Failed to get balance:', balanceResult.error);
    }
}

async function checkBalanceWithAlerts(monitor) {
    console.log('💰 Checking Balance with Alert System');
    console.log('------------------------------------\n');

    const result = await monitor.checkBalance();
    
    if (result.success) {
        console.log(`💰 Current balance: $${result.balance}`);
        
        if (result.belowThreshold) {
            console.log(`⚠️  Balance is below threshold ($${monitor.alertThreshold})`);
            
            if (result.alertSent) {
                console.log('📧 Alert email sent successfully');
            } else {
                console.log('⏰ Alert not sent (too soon since last alert)');
            }
        } else {
            console.log('✅ Balance is sufficient');
        }
        
        console.log(`🕐 Check time: ${new Date(result.timestamp).toLocaleString()}`);
        
    } else {
        console.log('❌ Balance check failed:', result.error);
    }
}

function showUsage() {
    console.log('Usage:');
    console.log('  node balance-check.js                    # Check balance and send alerts');
    console.log('  node balance-check.js --check-only       # Check balance without alerts');
    console.log('  node balance-check.js --test-email       # Test email configuration');
    console.log('  node balance-check.js --send-test        # Send test email');
    console.log('  node balance-check.js --force-alert      # Force send alert');
    console.log('  node balance-check.js --status           # Show status and config');
    console.log('  node balance-check.js --help             # Show this help');
    console.log();
    console.log('Environment Variables:');
    console.log('  BALANCE_ALERT_THRESHOLD   # Alert threshold (default: 5.0)');
    console.log('  ALERT_EMAIL              # Email recipient (default: thomas.seewald@gmail.com)');
    console.log('  CAPTCHA_API_KEY          # 2Captcha API key');
    console.log('  SMTP_USER                # Gmail address for sending');
    console.log('  SMTP_PASS                # Gmail App Password');
    console.log('  SMTP_HOST                # SMTP server (default: smtp.gmail.com)');
    console.log('  SMTP_PORT                # SMTP port (default: 587)');
}

// Run the main function
main().catch(error => {
    console.error('💥 Critical error:', error);
    process.exit(1);
});