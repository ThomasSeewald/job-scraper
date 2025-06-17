#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production

# Run complete API data collection (all PLZ, 14-day lookback, progressive batches)
node run-complete-background-scan.js --once >> logs/cron-scan.log 2>&1

# Check 2Captcha balance and send alerts if needed
echo "$(date): Checking 2Captcha balance..." >> logs/balance-monitor.log
node balance-check.js >> logs/balance-monitor.log 2>&1

# Rotate logs if they get too large
if [ -f logs/cron-scan.log ] && [ $(wc -c < logs/cron-scan.log) -gt 10485760 ]; then
    mv logs/cron-scan.log logs/cron-scan.log.old
fi

if [ -f logs/balance-monitor.log ] && [ $(wc -c < logs/balance-monitor.log) -gt 5242880 ]; then
    mv logs/balance-monitor.log logs/balance-monitor.log.old
fi
