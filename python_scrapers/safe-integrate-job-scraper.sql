-- Safe Integration: Job Scraper Data → our_domains
-- This version handles duplicates and constraints properly

BEGIN;

-- 1. Show current state
SELECT 'BEFORE INTEGRATION' as status;
SELECT 
    'our_domains total' as metric, COUNT(*) as count FROM our_domains
UNION ALL
SELECT 
    'employment_agency source' as metric, COUNT(*) as count FROM our_domains WHERE source = 'employment_agency'
UNION ALL
SELECT 
    'job_details with valid domains' as metric, COUNT(DISTINCT company_domain) as count 
    FROM job_scrp_job_details 
    WHERE company_domain IS NOT NULL 
        AND LENGTH(company_domain) > 0
        AND company_domain NOT IN ('could not find a related query', 'None', 'null', '')
        AND company_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}';

-- 2. Create staging table for new domains
CREATE TEMP TABLE staging_new_domains AS
WITH employer_domain_data AS (
    -- Get best data for each employer+domain
    SELECT DISTINCT ON (j.arbeitgeber, normalized_domain)
        j.arbeitgeber as employer_name,
        LOWER(TRIM(
            REGEXP_REPLACE(
                REGEXP_REPLACE(jd.company_domain, '^https?://', ''), 
                '^www\.', ''
            )
        )) as normalized_domain,
        jd.best_email,
        jd.contact_emails,
        jd.impressum_emails,
        jd.kontakt_emails,
        jd.karriere_emails,
        jd.jobs_emails,
        j.arbeitsort_plz as zip,
        j.arbeitsort_ort as city,
        COUNT(*) OVER (PARTITION BY j.arbeitgeber, LOWER(TRIM(
            REGEXP_REPLACE(
                REGEXP_REPLACE(jd.company_domain, '^https?://', ''), 
                '^www\.', ''
            )
        ))) as job_count
    FROM job_scrp_arbeitsagentur_jobs_v2 j
    JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
    WHERE jd.company_domain IS NOT NULL 
        AND LENGTH(jd.company_domain) > 0
        AND jd.company_domain NOT IN ('could not find a related query', 'None', 'null', '')
        AND jd.company_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}'
        AND j.is_active = true
    ORDER BY j.arbeitgeber, normalized_domain, j.aktuelleveroeffentlichungsdatum DESC
)
SELECT 
    employer_name,
    normalized_domain,
    -- Pick best email
    COALESCE(
        best_email,
        CASE 
            WHEN contact_emails IS NOT NULL AND LENGTH(contact_emails) > 0 
            THEN SPLIT_PART(contact_emails, ',', 1)
            WHEN impressum_emails IS NOT NULL AND LENGTH(impressum_emails) > 0
            THEN SPLIT_PART(impressum_emails, ',', 1)
            WHEN jobs_emails IS NOT NULL AND LENGTH(jobs_emails) > 0
            THEN SPLIT_PART(jobs_emails, ',', 1)
            ELSE NULL
        END
    ) as calculated_best_email,
    contact_emails,
    COALESCE(impressum_emails, kontakt_emails) as impressum_emails,
    COALESCE(jobs_emails, karriere_emails) as jobs_emails,
    zip,
    city,
    -- Check if any emails exist
    CASE 
        WHEN COALESCE(contact_emails, '') != '' 
          OR COALESCE(impressum_emails, '') != ''
          OR COALESCE(kontakt_emails, '') != ''
          OR COALESCE(karriere_emails, '') != ''
          OR COALESCE(jobs_emails, '') != ''
        THEN true
        ELSE false
    END as has_emails,
    job_count
FROM employer_domain_data
WHERE NOT EXISTS (
    -- Check if domain already exists (case-insensitive)
    SELECT 1 
    FROM our_domains d 
    WHERE LOWER(TRIM(d.domain)) = employer_domain_data.normalized_domain
);

-- Show statistics
SELECT 
    'New domains to add' as status, 
    COUNT(*) as total,
    COUNT(CASE WHEN has_emails THEN 1 END) as with_emails,
    SUM(job_count) as total_jobs_covered
FROM staging_new_domains;

-- 3. Insert new domains (avoiding duplicates)
INSERT INTO our_domains (
    the_name,
    domain,
    best_email,
    email_contact,
    email_impressum,
    email_jobs,
    zip,
    city,
    source,
    emails_found,
    domain_scaned_for_emails,
    create_date,
    write_date
)
SELECT 
    employer_name,
    normalized_domain,
    calculated_best_email,
    contact_emails,
    impressum_emails,
    jobs_emails,
    zip,
    city,
    'employment_agency',
    has_emails,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM staging_new_domains
ON CONFLICT (domain) DO NOTHING; -- Skip if somehow still duplicate

-- 4. Update existing employment_agency domains with new data
WITH updates AS (
    SELECT 
        d.id,
        d.domain,
        -- Merge emails
        CASE 
            WHEN d.best_email IS NULL AND jd.best_email IS NOT NULL 
            THEN jd.best_email
            ELSE d.best_email
        END as new_best_email,
        CASE 
            WHEN d.email_contact IS NULL THEN jd.contact_emails
            WHEN jd.contact_emails IS NULL THEN d.email_contact
            WHEN d.email_contact != jd.contact_emails 
            THEN d.email_contact || ',' || jd.contact_emails
            ELSE d.email_contact
        END as new_contact,
        -- Update location if missing
        COALESCE(d.zip, j.arbeitsort_plz) as new_zip,
        COALESCE(d.city, j.arbeitsort_ort) as new_city,
        -- Check if adding new data
        CASE 
            WHEN (d.email_contact IS NULL AND jd.contact_emails IS NOT NULL)
              OR (d.best_email IS NULL AND jd.best_email IS NOT NULL)
            THEN true
            ELSE false
        END as has_new_data
    FROM our_domains d
    JOIN job_scrp_job_details jd ON LOWER(TRIM(d.domain)) = LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(jd.company_domain, '^https?://', ''), 
            '^www\.', ''
        )
    ))
    JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.refnr = jd.reference_number
    WHERE d.source = 'employment_agency'
        AND j.is_active = true
        AND jd.company_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}'
)
UPDATE our_domains
SET 
    best_email = updates.new_best_email,
    email_contact = updates.new_contact,
    zip = updates.new_zip,
    city = updates.new_city,
    emails_found = true,
    write_date = CURRENT_TIMESTAMP
FROM updates
WHERE our_domains.id = updates.id
    AND updates.has_new_data = true;

-- 5. Final statistics
SELECT 'AFTER INTEGRATION' as status;
SELECT 
    'our_domains total' as metric, COUNT(*) as count FROM our_domains
UNION ALL
SELECT 
    'employment_agency source' as metric, COUNT(*) as count FROM our_domains WHERE source = 'employment_agency'
UNION ALL
SELECT 
    'employment_agency with emails' as metric, COUNT(*) as count 
    FROM our_domains WHERE source = 'employment_agency' AND emails_found = true;

-- 6. Show sample of new additions
SELECT 
    'Sample new domains' as status,
    the_name,
    domain,
    best_email,
    zip || ' ' || city as location
FROM our_domains 
WHERE source = 'employment_agency' 
    AND create_date >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
ORDER BY create_date DESC
LIMIT 10;

-- 7. Update our integration tracking
UPDATE our_employer_domain_matches m
SET status = 'verified',
    emails_found = true,
    verified_at = CURRENT_TIMESTAMP
FROM our_domains d
WHERE m.domain_url = d.domain
    AND d.emails_found = true
    AND m.status = 'pending';

SELECT 'Integration tracking updated' as status, COUNT(*) as matches_verified
FROM our_employer_domain_matches 
WHERE status = 'verified' AND verified_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes';

COMMIT;