#!/bin/bash

# Overnight parallel keyword scraping
# Runs with 5 workers to process domains quickly during low-usage hours

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/cron-overnight-parallel.log"

# Function to log with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check the current hour (0-23)
HOUR=$(date +%H)

# Only run during overnight hours (10 PM to 6 AM)
if [ $HOUR -ge 22 ] || [ $HOUR -lt 6 ]; then
    log_message "Starting overnight parallel processing (hour: $HOUR)"
    
    # Run with 5 workers, 20 domains each = 100 domains per round
    "$SCRIPT_DIR/run-parallel-keyword-scraper.sh" 5 20
    
    log_message "Overnight parallel processing completed"
else
    log_message "Skipping - not overnight hours (current hour: $HOUR)"
fi