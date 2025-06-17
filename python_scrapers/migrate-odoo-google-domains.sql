-- Migration Script: Move Odoo Google Domains data to new unified system
-- This script migrates data from our_google_domains and our_domains tables

-- First, ensure the new table exists
-- (Run create-google-domains-service.sql first if not already done)

BEGIN;

-- Step 1: Migrate Google search results from our_google_domains
INSERT INTO google_domains_service (
    query_company_name,
    query_street,
    query_postal_code,
    query_city,
    query_full,
    query_source,
    result_title,
    result_url,
    result_snippet,
    result_domain,
    is_verified,
    impressum_url,
    google_search_date,
    created_by,
    created_at
)
SELECT DISTINCT ON (employer, website)  -- Avoid duplicates
    employer as query_company_name,
    NULL as query_street,  -- Not stored separately in old system
    -- Extract postal code from address if available
    CASE 
        WHEN address ~ '\d{5}' THEN 
            (regexp_match(address, '(\d{5})'))[1]
        ELSE NULL
    END as query_postal_code,
    NULL as query_city,
    employment_agency_query as query_full,
    'odoo_migration' as query_source,
    title as result_title,
    website as result_url,
    address as result_snippet,  -- Store address in snippet for reference
    -- Clean domain extraction
    CASE 
        WHEN website IS NOT NULL THEN
            regexp_replace(
                regexp_replace(
                    regexp_replace(website, '^https?://', ''),
                    '^www\.', ''
                ),
                '/.*$', ''
            )
        ELSE NULL
    END as result_domain,
    moved_to_domains as is_verified,
    NULL as impressum_url,
    create_date as google_search_date,
    'odoo_migration' as created_by,
    create_date as created_at
FROM our_google_domains
WHERE employer IS NOT NULL 
    AND website IS NOT NULL
ORDER BY employer, website, create_date DESC
ON CONFLICT (query_company_name, result_domain) DO UPDATE SET
    updated_at = CURRENT_TIMESTAMP,
    query_full = COALESCE(EXCLUDED.query_full, google_domains_service.query_full);

-- Log migration progress
DO $$
DECLARE
    migrated_count INTEGER;
BEGIN
    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE 'Migrated % Google search results from our_google_domains', migrated_count;
END $$;

-- Step 2: Create temporary mapping table for domains
CREATE TEMP TABLE domain_mapping AS
SELECT DISTINCT
    d.id as domain_id,
    d.domain,
    d.best_domain,
    d.the_name,
    d.zip,
    d.city,
    d.street_number,
    d.query,
    COALESCE(d.best_email, d.email_impressum, d.email_contact, d.email_jobs) as primary_email,
    d.email_impressum,
    d.email_contact,
    d.email_jobs,
    d.email_first_page,
    d.emails_found,
    d.create_date,
    d.source as domain_source
FROM our_domains d
WHERE d.domain IS NOT NULL;

-- Step 3: Update existing records with email data
UPDATE google_domains_service gds
SET 
    impressum_emails = CASE 
        WHEN dm.email_impressum IS NOT NULL THEN 
            string_to_array(dm.email_impressum, ',')
        ELSE NULL
    END,
    kontakt_emails = CASE 
        WHEN dm.email_contact IS NOT NULL THEN 
            string_to_array(dm.email_contact, ',')
        ELSE NULL
    END,
    jobs_emails = CASE 
        WHEN dm.email_jobs IS NOT NULL THEN 
            string_to_array(dm.email_jobs, ',')
        ELSE NULL
    END,
    all_emails = ARRAY(
        SELECT DISTINCT unnest(
            string_to_array(
                COALESCE(dm.email_impressum, '') || ',' || 
                COALESCE(dm.email_contact, '') || ',' || 
                COALESCE(dm.email_jobs, '') || ',' ||
                COALESCE(dm.email_first_page, ''),
                ','
            )
        )
        WHERE unnest IS NOT NULL AND unnest != ''
    ),
    email_extraction_date = COALESCE(gds.email_extraction_date, dm.create_date),
    domain_type = CASE 
        WHEN dm.emails_found = true THEN 'employer'
        ELSE COALESCE(gds.domain_type, 'unknown')
    END,
    updated_at = CURRENT_TIMESTAMP
FROM domain_mapping dm
WHERE gds.result_domain = dm.domain
    OR gds.result_domain = dm.best_domain;

-- Log update progress
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % existing records with email data', updated_count;
END $$;

-- Step 4: Insert domains that don't have Google search results yet
INSERT INTO google_domains_service (
    query_company_name,
    query_street,
    query_postal_code,
    query_city,
    query_full,
    query_source,
    result_domain,
    impressum_emails,
    kontakt_emails,
    jobs_emails,
    all_emails,
    email_extraction_date,
    domain_type,
    is_verified,
    created_by,
    created_at
)
SELECT 
    COALESCE(dm.the_name, dm.query, 'Unknown') as query_company_name,
    dm.street_number as query_street,
    dm.zip as query_postal_code,
    dm.city as query_city,
    COALESCE(dm.query, dm.the_name || ' ' || dm.zip) as query_full,
    'odoo_domains_' || COALESCE(dm.domain_source, 'unknown') as query_source,
    dm.domain as result_domain,
    CASE 
        WHEN dm.email_impressum IS NOT NULL THEN 
            string_to_array(dm.email_impressum, ',')
        ELSE NULL
    END as impressum_emails,
    CASE 
        WHEN dm.email_contact IS NOT NULL THEN 
            string_to_array(dm.email_contact, ',')
        ELSE NULL
    END as kontakt_emails,
    CASE 
        WHEN dm.email_jobs IS NOT NULL THEN 
            string_to_array(dm.email_jobs, ',')
        ELSE NULL
    END as jobs_emails,
    ARRAY(
        SELECT DISTINCT unnest(
            string_to_array(
                COALESCE(dm.email_impressum, '') || ',' || 
                COALESCE(dm.email_contact, '') || ',' || 
                COALESCE(dm.email_jobs, '') || ',' ||
                COALESCE(dm.email_first_page, ''),
                ','
            )
        )
        WHERE unnest IS NOT NULL AND unnest != ''
    ) as all_emails,
    dm.create_date as email_extraction_date,
    CASE 
        WHEN dm.emails_found = true THEN 'employer'
        ELSE 'unknown'
    END as domain_type,
    true as is_verified,  -- These are already verified domains
    'odoo_migration' as created_by,
    dm.create_date as created_at
FROM domain_mapping dm
WHERE NOT EXISTS (
    SELECT 1 
    FROM google_domains_service gds 
    WHERE gds.result_domain = dm.domain 
        OR gds.result_domain = dm.best_domain
)
ON CONFLICT (query_company_name, result_domain) DO UPDATE SET
    all_emails = COALESCE(EXCLUDED.all_emails, google_domains_service.all_emails),
    email_extraction_date = COALESCE(EXCLUDED.email_extraction_date, google_domains_service.email_extraction_date),
    updated_at = CURRENT_TIMESTAMP;

-- Log insert progress
DO $$
DECLARE
    inserted_count INTEGER;
BEGIN
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RAISE NOTICE 'Inserted % new domain records from our_domains', inserted_count;
END $$;

-- Step 5: Create migration summary
CREATE TABLE IF NOT EXISTS google_domains_migration_log (
    id SERIAL PRIMARY KEY,
    migration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source_table VARCHAR(50),
    records_processed INTEGER,
    records_migrated INTEGER,
    notes TEXT
);

-- Log migration summary
INSERT INTO google_domains_migration_log (source_table, records_processed, records_migrated, notes)
SELECT 
    'our_google_domains',
    (SELECT COUNT(*) FROM our_google_domains WHERE employer IS NOT NULL),
    (SELECT COUNT(*) FROM google_domains_service WHERE created_by = 'odoo_migration' AND query_source = 'odoo_migration'),
    'Google search results migration'
UNION ALL
SELECT 
    'our_domains',
    (SELECT COUNT(*) FROM our_domains WHERE domain IS NOT NULL),
    (SELECT COUNT(*) FROM google_domains_service WHERE created_by = 'odoo_migration' AND query_source LIKE 'odoo_domains_%'),
    'Domain email data migration';

-- Final summary
DO $$
DECLARE
    total_migrated INTEGER;
    domains_with_emails INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_migrated
    FROM google_domains_service 
    WHERE created_by = 'odoo_migration';
    
    SELECT COUNT(*) INTO domains_with_emails
    FROM google_domains_service 
    WHERE created_by = 'odoo_migration'
        AND all_emails IS NOT NULL 
        AND array_length(all_emails, 1) > 0;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== Migration Summary ===';
    RAISE NOTICE 'Total records migrated: %', total_migrated;
    RAISE NOTICE 'Records with emails: %', domains_with_emails;
    RAISE NOTICE '========================';
END $$;

COMMIT;

-- Verify migration
SELECT 
    query_source,
    COUNT(*) as total_records,
    COUNT(CASE WHEN is_verified = true THEN 1 END) as verified,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as with_emails
FROM google_domains_service
WHERE created_by = 'odoo_migration'
GROUP BY query_source
ORDER BY total_records DESC;