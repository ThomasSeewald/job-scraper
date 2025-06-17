#!/bin/bash

# Migration Script for Google Domains Data
# This migrates existing data from Odoo tables to the new unified system

echo "=========================================="
echo "Google Domains Data Migration"
echo "=========================================="
echo ""
echo "This will migrate data from:"
echo "  - our_google_domains (Google search results)"
echo "  - our_domains (Domain email data)"
echo ""
echo "To the new unified table:"
echo "  - google_domains_service"
echo ""
echo "Database: jetzt on localhost:5473"
echo ""

read -p "Do you want to continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled."
    exit 1
fi

echo ""
echo "Starting migration..."
echo ""

# First ensure the new table structure exists
echo "1. Creating new table structure..."
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f create-google-domains-service.sql

if [ $? -ne 0 ]; then
    echo "Error creating table structure. Please check the error above."
    exit 1
fi

# Run the migration
echo ""
echo "2. Migrating data from Odoo tables..."
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f migrate-odoo-google-domains.sql

if [ $? -ne 0 ]; then
    echo "Error during migration. Please check the error above."
    exit 1
fi

echo ""
echo "=========================================="
echo "Migration completed successfully!"
echo "=========================================="
echo ""
echo "You can now:"
echo "1. Start the Google Domains API service:"
echo "   python3 google_domains_api.py"
echo ""
echo "2. View the Employer Domains dashboard:"
echo "   http://localhost:3001/employer-domains"
echo ""