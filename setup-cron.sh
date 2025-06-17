#!/bin/bash

# Setup script for automated job scraping
# This sets up cron jobs for regular scanning

SCRIPT_DIR="/Users/thomassee/Docker/containers/job-scraper"
LOG_DIR="$SCRIPT_DIR/logs"

# Create logs directory
mkdir -p "$LOG_DIR"

echo "🔧 Setting up automated job scraping..."

# Create wrapper script for cron
cat > "$SCRIPT_DIR/cron-scan.sh" << 'EOF'
#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production

# Run single scan cycle
node run-background-scan.js --once >> logs/cron-scan.log 2>&1

# Rotate logs if they get too large
if [ -f logs/cron-scan.log ] && [ $(wc -c < logs/cron-scan.log) -gt 10485760 ]; then
    mv logs/cron-scan.log logs/cron-scan.log.old
fi
EOF

chmod +x "$SCRIPT_DIR/cron-scan.sh"

echo "✅ Created cron wrapper script: $SCRIPT_DIR/cron-scan.sh"

# Show current crontab
echo ""
echo "📋 Current crontab:"
crontab -l 2>/dev/null || echo "No existing crontab"

echo ""
echo "🕐 Suggested cron schedule options:"
echo ""
echo "Option 1 - Every 4 hours:"
echo "0 */4 * * * $SCRIPT_DIR/cron-scan.sh"
echo ""
echo "Option 2 - Every 6 hours at specific times:"
echo "0 6,12,18 * * * $SCRIPT_DIR/cron-scan.sh"
echo ""
echo "Option 3 - Twice daily (morning and evening):"
echo "0 9,21 * * * $SCRIPT_DIR/cron-scan.sh"
echo ""
echo "To add a cron job, run:"
echo "crontab -e"
echo ""
echo "Or use one of these commands:"
echo ""
echo "# Every 4 hours"
echo "(crontab -l 2>/dev/null; echo '0 */4 * * * $SCRIPT_DIR/cron-scan.sh') | crontab -"
echo ""
echo "# Twice daily"
echo "(crontab -l 2>/dev/null; echo '0 9,21 * * * $SCRIPT_DIR/cron-scan.sh') | crontab -"
echo ""
echo "To check scan status anytime:"
echo "cat $SCRIPT_DIR/scan-status.json"
echo ""
echo "To view logs:"
echo "tail -f $SCRIPT_DIR/background-scan.log"