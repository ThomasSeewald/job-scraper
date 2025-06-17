#!/bin/bash

# Cron script for keyword-based domain email scraping
# This script runs independently from arbeitsagentur scraping
# Processes domains that don't have emails yet using keyword-based page detection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/cron-keyword-scraper.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if another instance is running
check_running() {
    local pids=$(pgrep -f "keyword-domain-scraper.js" | grep -v $$)
    if [ ! -z "$pids" ]; then
        log_message "Keyword scraper already running (PID: $pids), skipping this run"
        exit 0
    fi
}

# Function to check remaining domains
check_remaining_domains() {
    local remaining=$(PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "
        SELECT COUNT(*)
        FROM domain_analysis da
        WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
        AND da.domain IS NOT NULL 
        AND da.domain <> '';
    " 2>/dev/null | tr -d ' ')
    
    echo "$remaining"
}

# Main execution
main() {
    log_message "=== Starting keyword domain scraping cron job ==="
    
    # Check if another instance is running
    check_running
    
    # Check how many domains are left to process
    REMAINING=$(check_remaining_domains)
    
    if [ -z "$REMAINING" ] || [ "$REMAINING" -eq 0 ]; then
        log_message "No domains left to process. All domains have been scraped for keywords."
        exit 0
    fi
    
    log_message "Found $REMAINING domains remaining to scrape for keywords"
    
    # Set environment for headless operation
    export HEADLESS_MODE=true
    export NODE_ENV=production
    
    # Navigate to script directory
    cd "$SCRIPT_DIR"
    
    # Determine batch size based on remaining domains
    BATCH_SIZE=25
    if [ "$REMAINING" -lt 25 ]; then
        BATCH_SIZE=$REMAINING
    fi
    
    log_message "Starting keyword scraping with batch size: $BATCH_SIZE"
    
    # Run the keyword domain scraper
    if node src/keyword-domain-scraper.js $BATCH_SIZE >> "$LOG_FILE" 2>&1; then
        log_message "Keyword scraping completed successfully"
        
        # Check remaining domains after processing
        NEW_REMAINING=$(check_remaining_domains)
        PROCESSED=$((REMAINING - NEW_REMAINING))
        
        log_message "Processed $PROCESSED domains, $NEW_REMAINING domains remaining"
        
        if [ "$NEW_REMAINING" -eq 0 ]; then
            log_message "🎉 ALL DOMAINS HAVE BEEN PROCESSED FOR KEYWORDS! 🎉"
            log_message "Keyword scraping campaign is complete."
        fi
        
    else
        log_message "ERROR: Keyword scraping failed"
        exit 1
    fi
    
    log_message "=== Keyword domain scraping cron job completed ==="
}

# Execute main function
main "$@"