#!/bin/bash

# Email Search Interface Startup Script
echo "🚀 Starte Email-Suchinterface..."

cd /Users/thomassee/Docker/containers/job-scraper

# Check if Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js nicht gefunden!"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installiere npm dependencies..."
    npm install
fi

# Start the interface
echo "🌐 Starte Email-Suchinterface auf Port 3001..."
echo "📧 Interface verfügbar unter: http://localhost:3001"
echo ""
echo "Features:"
echo "  ✅ Suche nach Berufsarten (z.B. 'Informatiker', 'Verkäufer')"
echo "  ✅ Entfernungsfilter (5-200 km von PLZ/Ort)"
echo "  ✅ Firmen- und Domain-Filter"
echo "  ✅ CSV/JSON Export der Suchergebnisse"
echo "  ✅ Autocomplete für Berufe und Unternehmen"
echo ""
echo "🛑 Drücken Sie Ctrl+C zum Beenden"

node src/email-search-interface.js