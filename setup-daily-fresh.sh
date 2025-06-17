#!/bin/bash

# Setup Daily Fresh Scanner
# This sets up a separate daily scan for the last 2 days

SCRIPT_DIR="/Users/thomassee/Docker/containers/job-scraper"

echo "🆕 Setting up Daily Fresh Scanner..."

# Create wrapper script for daily fresh cron
cat > "$SCRIPT_DIR/cron-daily-fresh.sh" << 'EOF'
#!/bin/bash
cd /Users/thomassee/Docker/containers/job-scraper
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_ENV=production

# Run daily fresh scan (2 days, all PLZ)
node daily-fresh-scanner.js >> logs/daily-fresh.log 2>&1

# Rotate logs if they get too large (keep last 5MB)
if [ -f logs/daily-fresh.log ] && [ $(wc -c < logs/daily-fresh.log) -gt 5242880 ]; then
    mv logs/daily-fresh.log logs/daily-fresh.log.old
fi
EOF

chmod +x "$SCRIPT_DIR/cron-daily-fresh.sh"

echo "✅ Created daily fresh cron script: $SCRIPT_DIR/cron-daily-fresh.sh"

# Create logs directory if not exists
mkdir -p "$SCRIPT_DIR/logs"

echo ""
echo "📋 Current crontab (existing jobs):"
crontab -l 2>/dev/null || echo "No existing crontab"

echo ""
echo "🕐 Suggested schedule for Daily Fresh Scanner:"
echo ""
echo "Option 1 - Daily at 6 AM:"
echo "0 6 * * * $SCRIPT_DIR/cron-daily-fresh.sh"
echo ""
echo "Option 2 - Daily at 2 AM (less traffic):"
echo "0 2 * * * $SCRIPT_DIR/cron-daily-fresh.sh"
echo ""
echo "Option 3 - Twice daily (6 AM and 6 PM):"
echo "0 6,18 * * * $SCRIPT_DIR/cron-daily-fresh.sh"
echo ""
echo "To add daily fresh scan cron job:"
echo ""
echo "# Daily at 6 AM"
echo "(crontab -l 2>/dev/null; echo '0 6 * * * $SCRIPT_DIR/cron-daily-fresh.sh') | crontab -"
echo ""
echo "# Daily at 2 AM"
echo "(crontab -l 2>/dev/null; echo '0 2 * * * $SCRIPT_DIR/cron-daily-fresh.sh') | crontab -"
echo ""
echo "Current setup:"
echo "• Background scanner: Every 4 hours (28 days, prioritized PLZ)"
echo "• Daily fresh scanner: Once daily (2 days, ALL PLZ sequential)"
echo ""
echo "To test the daily fresh scanner now:"
echo "node $SCRIPT_DIR/daily-fresh-scanner.js"
echo ""
echo "To monitor performance:"
echo "cat $SCRIPT_DIR/plz-performance.json | jq '.\"10115\"'  # Check specific PLZ"
echo "tail -f $SCRIPT_DIR/daily-fresh.log"