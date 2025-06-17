#!/bin/bash

# Domain-based Email Extraction Cron Job
# Processes employer domains (not external portals) for email discovery
# Using Puppeteer technology similar to existing Scrapy approach

cd "$(dirname "$0")"

LOG_FILE="logs/cron-domain-extraction.log"
SCRIPT_NAME="src/puppeteer-domain-email-extractor.js"

# Ensure logs directory exists
mkdir -p logs

# Function to log with timestamp
log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_with_timestamp "Starting domain-based email extraction cron job"

# Check if Node.js script exists
if [ ! -f "$SCRIPT_NAME" ]; then
    log_with_timestamp "ERROR: Script $SCRIPT_NAME not found"
    exit 1
fi

# Set environment for headless operation
export HEADLESS_MODE=true
export NODE_ENV=production

# Process up to 5 domains per run (conservative approach)
DOMAINS_PER_RUN=5

log_with_timestamp "Processing up to $DOMAINS_PER_RUN employer domains"

# Run the domain email extractor
if node "$SCRIPT_NAME" "$DOMAINS_PER_RUN" >> "$LOG_FILE" 2>&1; then
    log_with_timestamp "Domain email extraction completed successfully"
    
    # Check balance after extraction session (reuse existing balance check)
    if [ -f "balance-check.js" ]; then
        log_with_timestamp "Checking 2captcha balance after domain extraction session"
        node balance-check.js >> "$LOG_FILE" 2>&1
    fi
else
    log_with_timestamp "ERROR: Domain email extraction failed with exit code $?"
    exit 1
fi

log_with_timestamp "Domain-based email extraction cron job completed"