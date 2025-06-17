-- Simple Migration Script without complex deduplication
-- Run create-google-domains-service.sql first!

BEGIN;

-- Count what we're migrating
SELECT COUNT(*) as google_domains_count FROM our_google_domains WHERE employer IS NOT NULL;
SELECT COUNT(*) as domains_count FROM our_domains WHERE domain IS NOT NULL;

-- Step 1: Migrate unique Google search results
INSERT INTO google_domains_service (
    query_company_name,
    query_full,
    query_source,
    result_title,
    result_url,
    result_domain,
    is_verified,
    google_search_date,
    created_by
)
SELECT 
    employer,
    employment_agency_query,
    'odoo_migration',
    title,
    website,
    regexp_replace(
        regexp_replace(
            regexp_replace(COALESCE(website, ''), '^https?://', ''),
            '^www\.', ''
        ),
        '/.*$', ''
    ),
    moved_to_domains,
    create_date,
    'odoo_migration'
FROM (
    SELECT DISTINCT ON (employer, website)
        employer,
        employment_agency_query,
        title,
        website,
        moved_to_domains,
        create_date
    FROM our_google_domains
    WHERE employer IS NOT NULL 
        AND website IS NOT NULL
    ORDER BY employer, website, create_date DESC
) unique_results
ON CONFLICT (query_company_name, result_domain) DO NOTHING;

-- Log progress
DO $$
DECLARE
    migrated_count INTEGER;
BEGIN
    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE 'Migrated % Google search results', migrated_count;
END $$;

-- Step 2: Insert unique domains with emails
INSERT INTO google_domains_service (
    query_company_name,
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
    created_by
)
SELECT 
    COALESCE(the_name, 'Unknown'),
    zip,
    city,
    COALESCE(the_name || ' ' || zip, domain, 'Unknown'),  -- query_full
    'odoo_domains',
    domain,
    CASE WHEN email_impressum IS NOT NULL THEN string_to_array(email_impressum, ',') END,
    CASE WHEN email_contact IS NOT NULL THEN string_to_array(email_contact, ',') END,
    CASE WHEN email_jobs IS NOT NULL THEN string_to_array(email_jobs, ',') END,
    ARRAY(
        SELECT DISTINCT email
        FROM unnest(
            string_to_array(
                COALESCE(email_impressum, '') || ',' || 
                COALESCE(email_contact, '') || ',' || 
                COALESCE(email_jobs, ''),
                ','
            )
        ) AS email
        WHERE email IS NOT NULL AND email != ''
    ),
    create_date,
    CASE WHEN emails_found = true THEN 'employer' ELSE 'unknown' END,
    true,
    'odoo_migration'
FROM (
    SELECT DISTINCT ON (domain)
        the_name,
        zip,
        city,
        domain,
        email_impressum,
        email_contact,
        email_jobs,
        emails_found,
        create_date
    FROM our_domains
    WHERE domain IS NOT NULL
    ORDER BY domain, create_date DESC
) unique_domains
WHERE NOT EXISTS (
    SELECT 1 FROM google_domains_service 
    WHERE result_domain = unique_domains.domain
)
ON CONFLICT (query_company_name, result_domain) DO NOTHING;

-- Log progress
DO $$
DECLARE
    migrated_count INTEGER;
BEGIN
    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE 'Migrated % domain records', migrated_count;
END $$;

COMMIT;

-- Show results
SELECT 
    query_source,
    COUNT(*) as total_records,
    COUNT(CASE WHEN is_verified = true THEN 1 END) as verified,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as with_emails
FROM google_domains_service
WHERE created_by = 'odoo_migration'
GROUP BY query_source
ORDER BY total_records DESC;