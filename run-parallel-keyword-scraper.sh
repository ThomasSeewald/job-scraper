#!/bin/bash

# Script to run parallel keyword domain scraping
# This runs multiple scrapers simultaneously for faster processing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/parallel-keyword-scraper.log"

# Default configuration
NUM_WORKERS=${1:-5}  # Number of parallel workers (default: 5)
BATCH_SIZE=${2:-10}  # Domains per worker per round (default: 10)

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if another instance is running
check_running() {
    local pids=$(pgrep -f "parallel-keyword-scraper.js" | grep -v $$)
    if [ ! -z "$pids" ]; then
        log_message "Parallel scraper already running (PID: $pids), exiting"
        exit 0
    fi
}

# Main execution
log_message "=== Starting Parallel Keyword Domain Scraping ==="
log_message "Configuration: $NUM_WORKERS workers, $BATCH_SIZE domains per worker"

# Check if another instance is running
check_running

# Set environment
export HEADLESS_MODE=true
export NODE_ENV=production

# Navigate to script directory
cd "$SCRIPT_DIR"

# Run the parallel scraper
log_message "Launching parallel scraper..."
node src/parallel-keyword-scraper.js $NUM_WORKERS $BATCH_SIZE >> "$LOG_FILE" 2>&1

log_message "=== Parallel Keyword Domain Scraping Completed ==="