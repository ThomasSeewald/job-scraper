#!/bin/bash

# Install the supervisor LaunchD service
echo "Installing Job Scraper Supervisor Service..."
echo "========================================="

# Define paths
PLIST_FILE="com.jobscraper.supervisor.plist"
LAUNCHAGENTS_DIR="$HOME/Library/LaunchAgents"
SOURCE_PATH="$(pwd)/$PLIST_FILE"
DEST_PATH="$LAUNCHAGENTS_DIR/$PLIST_FILE"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$LAUNCHAGENTS_DIR"

# Check if service is already loaded
if launchctl list | grep -q "com.jobscraper.supervisor"; then
    echo "Unloading existing service..."
    launchctl unload "$DEST_PATH" 2>/dev/null
fi

# Copy plist file to LaunchAgents
echo "Copying service configuration..."
cp "$SOURCE_PATH" "$DEST_PATH"

# Load the service
echo "Loading service..."
launchctl load "$DEST_PATH"

# Check if service loaded successfully
if launchctl list | grep -q "com.jobscraper.supervisor"; then
    echo "✅ Supervisor service installed successfully!"
    echo ""
    echo "Service Information:"
    echo "==================="
    launchctl list | grep com.jobscraper.supervisor
    echo ""
    echo "Service Commands:"
    echo "================"
    echo "View status:      launchctl list | grep com.jobscraper.supervisor"
    echo "Stop service:     launchctl unload ~/Library/LaunchAgents/com.jobscraper.supervisor.plist"
    echo "Start service:    launchctl load ~/Library/LaunchAgents/com.jobscraper.supervisor.plist"
    echo "View logs:        tail -f logs/supervisor.log"
    echo "View errors:      tail -f logs/supervisor-error.log"
    echo ""
    echo "The supervisor will now automatically:"
    echo "- Start when system boots"
    echo "- Restart if it crashes"
    echo "- Monitor and restart scrapers"
else
    echo "❌ Failed to install supervisor service"
    exit 1
fi