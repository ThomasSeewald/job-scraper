#!/bin/bash

# Start Dashboard Script
cd /Users/thomassee/Docker/containers/job-scraper

echo "🚀 Starting Job Scraper Combined Dashboard..."
echo "📊 Dashboard will be available at: http://localhost:3001"
echo "🔧 Health Check: http://localhost:3001/health"
echo "📧 Email Search: http://localhost:3001/email-search"
echo ""
echo "To stop the dashboard, press Ctrl+C"
echo ""

# Start the combined dashboard server
node src/combined-dashboard.js