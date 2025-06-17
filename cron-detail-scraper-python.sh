#!/bin/bash

# Cron script for newest job detail scraping - Python version
# Runs every 2 hours to process new employers

# Set working directory
cd /Users/thomassee/Docker/containers/job-scraper

# Set environment for headless operation
export HEADLESS_MODE=true

# Add timestamp to log
echo "========================================" >> logs/cron-detail-scraper.log
echo "Starting newest jobs scraper (Python) at $(date)" >> logs/cron-detail-scraper.log

# Run the Python scraper for 50 newest employers
python3 python_scrapers/newest_jobs_scraper.py 50 >> logs/cron-detail-scraper.log 2>&1

# Check exit status
if [ $? -eq 0 ]; then
    echo "✅ Newest jobs scraper completed successfully at $(date)" >> logs/cron-detail-scraper.log
else
    echo "❌ Newest jobs scraper failed at $(date)" >> logs/cron-detail-scraper.log
fi

echo "========================================" >> logs/cron-detail-scraper.log
echo "" >> logs/cron-detail-scraper.log