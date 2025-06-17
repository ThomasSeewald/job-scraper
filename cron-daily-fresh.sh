#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production

# Run daily fresh scan (2 days, all PLZ)
node daily-fresh-scanner.js >> logs/daily-fresh.log 2>&1

# Check 2Captcha balance (daily verification)
echo "$(date): Daily balance check..." >> logs/balance-monitor.log
node balance-check.js >> logs/balance-monitor.log 2>&1

# Rotate logs if they get too large (keep last 5MB)
if [ -f logs/daily-fresh.log ] && [ $(wc -c < logs/daily-fresh.log) -gt 5242880 ]; then
    mv logs/daily-fresh.log logs/daily-fresh.log.old
fi

if [ -f logs/balance-monitor.log ] && [ $(wc -c < logs/balance-monitor.log) -gt 5242880 ]; then
    mv logs/balance-monitor.log logs/balance-monitor.log.old
fi
