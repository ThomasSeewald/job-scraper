#!/bin/bash

# Setup script for keyword-based domain scraping cron job

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_SCRIPT="$SCRIPT_DIR/cron-keyword-scraper.sh"

echo "=== Keyword Domain Scraper Setup ==="
echo ""
echo "This script will set up automated keyword-based email scraping for domains"
echo "that currently don't have email addresses."
echo ""

# Check if script exists and is executable
if [ ! -x "$CRON_SCRIPT" ]; then
    echo "Error: $CRON_SCRIPT not found or not executable"
    exit 1
fi

# Check database connectivity
echo "Testing database connectivity..."
if PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✓ Database connection successful"
else
    echo "✗ Database connection failed"
    echo "Please ensure PostgreSQL is running on localhost:5473"
    exit 1
fi

# Count domains to be processed
TOTAL_DOMAINS=$(PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "
    SELECT COUNT(*)
    FROM domain_analysis da
    WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
    AND da.domain IS NOT NULL 
    AND da.domain <> '';
" 2>/dev/null | tr -d ' ')

echo ""
echo "📊 Status:"
echo "Domains to be processed: $TOTAL_DOMAINS"
echo ""

if [ "$TOTAL_DOMAINS" -eq 0 ]; then
    echo "No domains need keyword scraping. All domains have been processed."
    exit 0
fi

# Estimate processing time
ESTIMATED_HOURS=$((TOTAL_DOMAINS / 50))  # 25 domains per 30 minutes = 50 per hour
echo "Estimated processing time: ~$ESTIMATED_HOURS hours (at 50 domains/hour)"
echo ""

# Ask user for cron schedule preference
echo "Choose cron schedule for keyword scraping:"
echo "1) Every 30 minutes (recommended for overnight processing)"
echo "2) Every hour"
echo "3) Every 2 hours"
echo "4) Manual setup (show cron command)"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        CRON_SCHEDULE="*/30 * * * *"
        SCHEDULE_DESC="every 30 minutes"
        ;;
    2)
        CRON_SCHEDULE="0 * * * *"
        SCHEDULE_DESC="every hour"
        ;;
    3)
        CRON_SCHEDULE="0 */2 * * *"
        SCHEDULE_DESC="every 2 hours"
        ;;
    4)
        echo ""
        echo "Manual cron setup:"
        echo "Add this line to your crontab (crontab -e):"
        echo ""
        echo "# Keyword domain scraper - runs every 30 minutes"
        echo "*/30 * * * * $CRON_SCRIPT"
        echo ""
        echo "Or run manually: $CRON_SCRIPT"
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Add to cron
echo ""
echo "Adding cron job to run $SCHEDULE_DESC..."

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "cron-keyword-scraper.sh"; then
    echo "Keyword scraper cron job already exists. Updating..."
    # Remove old entry and add new one
    (crontab -l 2>/dev/null | grep -v "cron-keyword-scraper.sh"; echo "$CRON_SCHEDULE $CRON_SCRIPT") | crontab -
else
    # Add new entry
    (crontab -l 2>/dev/null; echo "$CRON_SCHEDULE $CRON_SCRIPT") | crontab -
fi

echo "✓ Cron job added successfully"
echo ""

# Create log directory
mkdir -p "$SCRIPT_DIR/logs"

echo "🚀 Setup Complete!"
echo ""
echo "The keyword domain scraper is now scheduled to run $SCHEDULE_DESC"
echo "It will automatically process domains and stop when all are complete."
echo ""
echo "Monitor progress with:"
echo "  tail -f $SCRIPT_DIR/logs/cron-keyword-scraper.log"
echo ""
echo "View current cron jobs:"
echo "  crontab -l"
echo ""
echo "Remove cron job:"
echo "  crontab -e  # and delete the line containing 'cron-keyword-scraper.sh'"
echo ""

# Ask if user wants to run a test
echo ""
read -p "Run a test with 5 domains now? [y/N]: " test_choice
if [ "$test_choice" = "y" ] || [ "$test_choice" = "Y" ]; then
    echo ""
    echo "Running test with 5 domains..."
    cd "$SCRIPT_DIR"
    node src/keyword-domain-scraper.js 5
    echo ""
    echo "Test completed. Check the output above for results."
fi

echo ""
echo "Setup finished! The scraper will begin processing domains automatically."