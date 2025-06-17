#!/bin/bash

# Cron script for historical employer scraping - Python version
# Runs every 6 hours to process historical backlog

# Set working directory
cd /Users/thomassee/Docker/containers/job-scraper

# Set environment for headless operation
export HEADLESS_MODE=true

# Add timestamp to log
echo "========================================" >> logs/cron-historical-scraper.log
echo "Starting historical employer scraper (Python) at $(date)" >> logs/cron-historical-scraper.log

# Run the Python scraper for 30 historical employers
python3 python_scrapers/historical_employer_scraper.py 30 >> logs/cron-historical-scraper.log 2>&1

# Check exit status
if [ $? -eq 0 ]; then
    echo "✅ Historical employer scraper completed successfully at $(date)" >> logs/cron-historical-scraper.log
else
    echo "❌ Historical employer scraper failed at $(date)" >> logs/cron-historical-scraper.log
fi

echo "========================================" >> logs/cron-historical-scraper.log
echo "" >> logs/cron-historical-scraper.log