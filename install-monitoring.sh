#!/bin/bash

# Job Scraper Monitoring Installation Script
# This script sets up automated monitoring that survives reboots

echo "🚀 Installing Job Scraper Balance Monitoring System"
echo "=================================================="

cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Create logs directory
mkdir -p logs

echo ""
echo "📋 Step 1: Verifying system requirements..."

# Check if Node.js is available
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js: $(node --version)"
else
    echo "❌ Node.js not found!"
    exit 1
fi

# Check if npm dependencies are installed
if [ -f package.json ] && [ -d node_modules ]; then
    echo "✅ npm dependencies installed"
else
    echo "⚠️  Installing npm dependencies..."
    npm install
fi

# Test 2Captcha connection
echo "🔧 Testing 2Captcha API connection..."
if npm run test-captcha-balance > /dev/null 2>&1; then
    echo "✅ 2Captcha API working"
else
    echo "⚠️  2Captcha API test failed - check API key"
fi

echo ""
echo "📋 Step 2: Installing cron jobs..."

# Backup existing crontab
crontab -l > "cron-backup-$(date +%Y%m%d-%H%M%S).txt" 2>/dev/null || echo "No existing crontab to backup"

# Install cron jobs (remove duplicates first)
echo "Installing background scan job (every 4 hours)..."
(crontab -l 2>/dev/null | grep -v "cron-scan.sh"; echo "0 */4 * * * /Users/thomassee/Docker/containers/job-scraper/cron-scan.sh") | crontab -

echo "Installing daily fresh scan job (daily at 6 AM)..."
(crontab -l 2>/dev/null | grep -v "cron-daily-fresh.sh"; echo "0 6 * * * /Users/thomassee/Docker/containers/job-scraper/cron-daily-fresh.sh") | crontab -

echo "✅ Cron jobs installed:"
crontab -l | grep "job-scraper"

echo ""
echo "📋 Step 3: Setting up automatic startup..."

# Make scripts executable
chmod +x cron-scan.sh
chmod +x cron-daily-fresh.sh
chmod +x startup-monitor.sh

# Install LaunchAgent for macOS automatic startup
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS_DIR"

if [ -f com.jobscraper.monitor.plist ]; then
    cp com.jobscraper.monitor.plist "$LAUNCH_AGENTS_DIR/"
    launchctl unload "$LAUNCH_AGENTS_DIR/com.jobscraper.monitor.plist" 2>/dev/null || true
    launchctl load "$LAUNCH_AGENTS_DIR/com.jobscraper.monitor.plist"
    echo "✅ LaunchAgent installed for automatic startup"
else
    echo "⚠️  LaunchAgent file not found"
fi

echo ""
echo "📋 Step 4: Testing email configuration..."

if npm run test-email > /dev/null 2>&1; then
    echo "✅ Email configuration working"
else
    echo "⚠️  Email configuration needs setup"
    echo "   Current config: lernen@learnandearn.me via smtp.ionos.de:25"
fi

echo ""
echo "📋 Step 5: Performing initial balance check..."

npm run check-balance-only

echo ""
echo "📋 Step 6: Testing complete system..."

# Run startup monitor to verify everything
./startup-monitor.sh

echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📊 Monitoring Schedule:"
echo "  • Balance checks: Every 4 hours (with job scraping)"
echo "  • Daily verification: Every day at 6 AM"
echo "  • Email alerts: When balance < $5"
echo "  • Recipient: thomas.seewald@gmail.com"
echo ""
echo "📁 Important Files:"
echo "  • Logs: logs/balance-monitor.log"
echo "  • Status: npm run balance-status"
echo "  • Manual check: npm run check-balance"
echo ""
echo "🔄 After Reboot:"
echo "  • Cron jobs will automatically resume"
echo "  • LaunchAgent will verify system status"
echo "  • Manual verification: ./startup-monitor.sh"
echo ""
echo "✅ Your balance monitoring system is now fully automated!"
echo "📧 You will receive email alerts at thomas.seewald@gmail.com when balance drops below $5"