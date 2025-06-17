#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production
export HEADLESS_MODE=true

# Run historical employer scraping (slower pace, 30 employers per run)
echo "$(date): Starting historical employer scraping..." >> logs/cron-historical-scraper.log
node src/historical-employer-scraper.js 30 >> logs/cron-historical-scraper.log 2>&1

# Check 2Captcha balance after historical scraping
echo "$(date): Checking 2Captcha balance after historical scraping..." >> logs/balance-monitor.log
node balance-check.js >> logs/balance-monitor.log 2>&1

echo "$(date): Historical scraping cycle completed" >> logs/cron-historical-scraper.log

# Rotate logs if they get too large
if [ -f logs/cron-historical-scraper.log ] && [ $(wc -c < logs/cron-historical-scraper.log) -gt 10485760 ]; then
    mv logs/cron-historical-scraper.log logs/cron-historical-scraper.log.old
fi