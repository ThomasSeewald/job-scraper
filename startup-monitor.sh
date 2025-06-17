#!/bin/bash

# Job Scraper Startup Monitor Script
# This script ensures all monitoring services are running after system reboot
# Run this script at system startup or manually after reboot

cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production

# Create logs directory if it doesn't exist
mkdir -p logs

echo "$(date): Starting Job Scraper monitoring services..." >> logs/startup.log

# Check if cron jobs are running
echo "$(date): Verifying cron jobs..." >> logs/startup.log
if ! crontab -l | grep -q "cron-scan.sh"; then
    echo "$(date): WARNING: Cron jobs not found! Installing..." >> logs/startup.log
    
    # Backup existing crontab
    crontab -l > cron-backup-$(date +%Y%m%d-%H%M%S).txt 2>/dev/null || true
    
    # Install cron jobs
    (crontab -l 2>/dev/null; echo "0 */4 * * * /Users/thomassee/Docker/containers/job-scraper/cron-scan.sh") | crontab -
    (crontab -l 2>/dev/null; echo "0 6 * * * /Users/thomassee/Docker/containers/job-scraper/cron-daily-fresh.sh") | crontab -
    
    echo "$(date): Cron jobs installed successfully" >> logs/startup.log
else
    echo "$(date): Cron jobs are configured" >> logs/startup.log
fi

# Verify cron service is running
if pgrep -x "cron" > /dev/null || launchctl list | grep -q "com.vix.cron" > /dev/null 2>&1; then
    echo "$(date): Cron service is running" >> logs/startup.log
else
    echo "$(date): WARNING: Cron service not running!" >> logs/startup.log
fi

# Test 2Captcha connection
echo "$(date): Testing 2Captcha connection..." >> logs/startup.log
if node -e "const solver = require('./src/independent-captcha-solver'); new solver().getBalance().then(r => console.log(r.success ? 'OK' : 'FAIL')).catch(() => console.log('FAIL'))" 2>/dev/null | grep -q "OK"; then
    echo "$(date): 2Captcha API connection: OK" >> logs/startup.log
else
    echo "$(date): WARNING: 2Captcha API connection failed!" >> logs/startup.log
fi

# Test email configuration
echo "$(date): Testing email configuration..." >> logs/startup.log
if node balance-check.js --test-email 2>/dev/null | grep -q "Email configuration test passed"; then
    echo "$(date): Email configuration: OK" >> logs/startup.log
else
    echo "$(date): WARNING: Email configuration failed!" >> logs/startup.log
fi

# Perform initial balance check
echo "$(date): Performing initial balance check..." >> logs/startup.log
node balance-check.js --check-only >> logs/startup.log 2>&1

# Check if dashboard is running
if lsof -i :3001 > /dev/null 2>&1; then
    echo "$(date): Dashboard is running on port 3001" >> logs/startup.log
else
    echo "$(date): INFO: Dashboard not running - start with 'npm run dashboard' if needed" >> logs/startup.log
fi

# Start continuous balance monitoring (optional background service)
if [ "$1" = "--start-monitor" ]; then
    echo "$(date): Starting continuous balance monitoring..." >> logs/startup.log
    nohup node src/balance-scheduler.js >> logs/balance-scheduler.log 2>&1 &
    echo $! > balance-scheduler.pid
    echo "$(date): Balance scheduler started with PID: $(cat balance-scheduler.pid)" >> logs/startup.log
fi

# Show summary
echo "$(date): Startup monitor completed" >> logs/startup.log
echo "======================================" >> logs/startup.log

# Display status to console
echo "🚀 Job Scraper Monitoring Services Status:"
echo "----------------------------------------"
echo "📅 Cron Jobs: $(crontab -l | grep -c "cron-.*\.sh") configured"
echo "💰 2Captcha API: $(node -e "const solver = require('./src/independent-captcha-solver'); new solver().getBalance().then(r => console.log(r.success ? 'Connected ($' + r.balance + ')' : 'Failed')).catch(() => console.log('Failed'))" 2>/dev/null)"
echo "📧 Email Config: $(node balance-check.js --test-email 2>/dev/null | grep -q "Email configuration test passed" && echo "Working" || echo "Needs setup")"
echo "📊 Dashboard: $(lsof -i :3001 > /dev/null 2>&1 && echo "Running (port 3001)" || echo "Not running")"
echo "📝 Logs: logs/startup.log, logs/balance-monitor.log"
echo ""
echo "✅ Monitoring system is ready!"
echo "📋 Balance alerts will be sent to: thomas.seewald@gmail.com"
echo "⏰ Next scheduled check: $(date -v+4H '+%Y-%m-%d %H:00:00')"
echo ""
echo "Commands:"
echo "  npm run check-balance      # Manual balance check"
echo "  npm run balance-status     # Show detailed status"
echo "  tail -f logs/balance-monitor.log  # Watch balance logs"