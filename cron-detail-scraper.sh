#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production
export HEADLESS_MODE=true

# Run detail scraping for new employers (extracts emails from pages with CAPTCHA automation)
echo "$(date): Starting detail scraping for new employers..." >> logs/cron-detail-scraper.log
node src/newest-jobs-scraper.js 50 >> logs/cron-detail-scraper.log 2>&1

# Check 2Captcha balance after scraping
echo "$(date): Checking 2Captcha balance after detail scraping..." >> logs/balance-monitor.log
node balance-check.js >> logs/balance-monitor.log 2>&1

echo "$(date): Detail scraping cycle completed" >> logs/cron-detail-scraper.log

# Rotate logs if they get too large
if [ -f logs/cron-detail-scraper.log ] && [ $(wc -c < logs/cron-detail-scraper.log) -gt 10485760 ]; then
    mv logs/cron-detail-scraper.log logs/cron-detail-scraper.log.old
fi