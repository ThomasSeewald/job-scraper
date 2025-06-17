#!/bin/bash

# Automated Migration Script for Google Domains Data
# This runs without user interaction

echo "=========================================="
echo "Google Domains Data Migration (Automated)"
echo "=========================================="
echo "Starting at: $(date)"
echo ""

# First ensure the new table structure exists
echo "1. Creating new table structure..."
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f create-google-domains-service.sql 2>&1

if [ $? -ne 0 ]; then
    echo "Error creating table structure. Continuing anyway as table might exist..."
fi

# Run the migration
echo ""
echo "2. Migrating data from Odoo tables..."
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f migrate-odoo-google-domains.sql 2>&1

if [ $? -ne 0 ]; then
    echo "Error during migration. Please check the error above."
    exit 1
fi

echo ""
echo "=========================================="
echo "Migration completed at: $(date)"
echo "=========================================="

# Show summary
echo ""
echo "Checking migration results..."
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "
SELECT 
    'Migrated from our_google_domains: ' || COUNT(*) 
FROM google_domains_service 
WHERE created_by = 'odoo_migration' 
    AND query_source = 'odoo_migration'
"

PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "
SELECT 
    'Migrated from our_domains: ' || COUNT(*) 
FROM google_domains_service 
WHERE created_by = 'odoo_migration' 
    AND query_source LIKE 'odoo_domains_%'
"

PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "
SELECT 
    'Total with emails: ' || COUNT(*) 
FROM google_domains_service 
WHERE created_by = 'odoo_migration'
    AND all_emails IS NOT NULL 
    AND array_length(all_emails, 1) > 0
"