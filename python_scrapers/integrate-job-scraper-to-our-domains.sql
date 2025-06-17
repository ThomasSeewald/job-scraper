-- Integration: Job Scraper Data → our_domains
-- This script integrates new employer domain data from job scraper into our_domains table

BEGIN;

-- 1. Show current state before integration
SELECT 'BEFORE INTEGRATION' as status;
SELECT 
    'our_domains total' as metric, COUNT(*) as count FROM our_domains
UNION ALL
SELECT 
    'employment_agency source' as metric, COUNT(*) as count FROM our_domains WHERE source = 'employment_agency'
UNION ALL
SELECT 
    'job_details with domains' as metric, COUNT(DISTINCT company_domain) as count 
    FROM job_scrp_job_details WHERE company_domain IS NOT NULL AND LENGTH(company_domain) > 0;

-- 2. Create temporary table with new domains to add
CREATE TEMP TABLE new_domains_to_add AS
WITH job_domain_data AS (
    -- Get the most recent job data for each employer+domain combination
    SELECT DISTINCT ON (j.arbeitgeber, jd.company_domain)
        j.arbeitgeber as employer_name,
        jd.company_domain as domain,
        jd.best_email,
        jd.contact_emails as email_contact,
        jd.impressum_emails as email_impressum,
        jd.kontakt_emails as email_kontakt,
        jd.karriere_emails as email_karriere,
        jd.jobs_emails as email_jobs,
        j.arbeitsort_plz as zip,
        j.arbeitsort_ort as city,
        -- Extract first email for best_email if not set
        COALESCE(
            jd.best_email,
            CASE 
                WHEN jd.contact_emails IS NOT NULL AND LENGTH(jd.contact_emails) > 0 
                THEN SPLIT_PART(jd.contact_emails, ',', 1)
                ELSE NULL
            END
        ) as calculated_best_email,
        -- Check if any emails exist
        CASE 
            WHEN COALESCE(jd.contact_emails, '') != '' 
              OR COALESCE(jd.impressum_emails, '') != ''
              OR COALESCE(jd.kontakt_emails, '') != ''
              OR COALESCE(jd.karriere_emails, '') != ''
              OR COALESCE(jd.jobs_emails, '') != ''
            THEN true
            ELSE false
        END as has_emails,
        jd.scraped_at,
        j.aktuelleveroeffentlichungsdatum
    FROM job_scrp_arbeitsagentur_jobs_v2 j
    JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
    WHERE jd.company_domain IS NOT NULL 
        AND LENGTH(jd.company_domain) > 0
        AND jd.company_domain NOT IN ('could not find a related query', 'None', 'null', '')
        AND jd.company_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}' -- Basic domain validation
        AND j.is_active = true
    ORDER BY j.arbeitgeber, jd.company_domain, j.aktuelleveroeffentlichungsdatum DESC
)
SELECT 
    employer_name,
    -- Normalize domain (remove protocols and www)
    LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(domain, '^https?://', ''), 
            '^www\.', ''
        )
    )) as normalized_domain,
    calculated_best_email,
    email_contact,
    email_impressum,
    email_kontakt,
    email_karriere,
    email_jobs,
    zip,
    city,
    has_emails,
    scraped_at
FROM job_domain_data
WHERE NOT EXISTS (
    -- Check if domain already exists in our_domains
    SELECT 1 
    FROM our_domains d 
    WHERE LOWER(TRIM(d.domain)) = LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(job_domain_data.domain, '^https?://', ''), 
            '^www\.', ''
        )
    ))
);

-- Show how many new domains we'll add
SELECT 'New domains to add' as status, COUNT(*) as count FROM new_domains_to_add;

-- 3. Insert new domains into our_domains
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
    email_contact,
    COALESCE(email_impressum, email_kontakt), -- Combine impressum and kontakt
    COALESCE(email_jobs, email_karriere), -- Combine jobs and karriere
    zip,
    city,
    'employment_agency',
    has_emails,
    true, -- Already scanned by job scraper
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM new_domains_to_add;

-- 4. Update existing domains with new email data
-- Create temp table for updates
CREATE TEMP TABLE domains_to_update AS
WITH job_updates AS (
    SELECT 
        d.id as domain_id,
        d.domain,
        d.best_email as existing_best_email,
        jd.best_email as new_best_email,
        d.email_contact as existing_contact,
        jd.contact_emails as new_contact,
        d.email_impressum as existing_impressum,
        COALESCE(jd.impressum_emails, jd.kontakt_emails) as new_impressum,
        d.email_jobs as existing_jobs,
        COALESCE(jd.jobs_emails, jd.karriere_emails) as new_jobs,
        d.zip as existing_zip,
        j.arbeitsort_plz as new_zip,
        d.city as existing_city,
        j.arbeitsort_ort as new_city
    FROM our_domains d
    JOIN job_scrp_job_details jd ON LOWER(TRIM(d.domain)) = LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(jd.company_domain, '^https?://', ''), 
            '^www\.', ''
        )
    ))
    JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.refnr = jd.reference_number
    WHERE d.source = 'employment_agency'
        AND jd.company_domain IS NOT NULL
        AND j.is_active = true
)
SELECT 
    domain_id,
    domain,
    -- Update best_email if not set
    CASE 
        WHEN existing_best_email IS NULL AND new_best_email IS NOT NULL 
        THEN new_best_email
        ELSE existing_best_email
    END as updated_best_email,
    -- Merge contact emails
    CASE 
        WHEN existing_contact IS NULL THEN new_contact
        WHEN new_contact IS NULL THEN existing_contact
        WHEN existing_contact = new_contact THEN existing_contact
        ELSE existing_contact || ',' || new_contact
    END as merged_contact,
    -- Merge impressum emails
    CASE 
        WHEN existing_impressum IS NULL THEN new_impressum
        WHEN new_impressum IS NULL THEN existing_impressum
        WHEN existing_impressum = new_impressum THEN existing_impressum
        ELSE existing_impressum || ',' || new_impressum
    END as merged_impressum,
    -- Merge jobs emails
    CASE 
        WHEN existing_jobs IS NULL THEN new_jobs
        WHEN new_jobs IS NULL THEN existing_jobs
        WHEN existing_jobs = new_jobs THEN existing_jobs
        ELSE existing_jobs || ',' || new_jobs
    END as merged_jobs,
    -- Update location if missing
    COALESCE(existing_zip, new_zip) as updated_zip,
    COALESCE(existing_city, new_city) as updated_city,
    -- Check if we're adding new emails
    CASE 
        WHEN (new_contact IS NOT NULL AND existing_contact IS NULL)
          OR (new_impressum IS NOT NULL AND existing_impressum IS NULL)
          OR (new_jobs IS NOT NULL AND existing_jobs IS NULL)
        THEN true
        ELSE false
    END as adding_new_emails
FROM job_updates;

-- Show update statistics
SELECT 
    'Domains to update' as status, 
    COUNT(*) as total,
    COUNT(CASE WHEN adding_new_emails THEN 1 END) as with_new_emails
FROM domains_to_update;

-- Perform the updates
UPDATE our_domains d
SET 
    best_email = u.updated_best_email,
    email_contact = u.merged_contact,
    email_impressum = u.merged_impressum,
    email_jobs = u.merged_jobs,
    zip = u.updated_zip,
    city = u.updated_city,
    emails_found = true,
    write_date = CURRENT_TIMESTAMP
FROM domains_to_update u
WHERE d.id = u.domain_id
    AND u.adding_new_emails = true;

-- 5. Show final statistics
SELECT 'AFTER INTEGRATION' as status;
SELECT 
    'our_domains total' as metric, COUNT(*) as count FROM our_domains
UNION ALL
SELECT 
    'employment_agency source' as metric, COUNT(*) as count FROM our_domains WHERE source = 'employment_agency'
UNION ALL
SELECT 
    'domains with emails' as metric, COUNT(*) as count FROM our_domains WHERE emails_found = true;

-- 6. Show sample of newly added domains
SELECT 'Sample new domains added' as status;
SELECT 
    the_name,
    domain,
    best_email,
    zip || ' ' || city as location,
    CASE WHEN emails_found THEN 'Yes' ELSE 'No' END as has_emails
FROM our_domains 
WHERE source = 'employment_agency' 
    AND create_date >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
ORDER BY create_date DESC
LIMIT 10;

-- 7. Create summary report
SELECT 'INTEGRATION SUMMARY' as report;
WITH stats AS (
    SELECT 
        (SELECT COUNT(*) FROM new_domains_to_add) as new_domains_added,
        (SELECT COUNT(*) FROM domains_to_update WHERE adding_new_emails) as domains_updated,
        (SELECT COUNT(*) FROM new_domains_to_add WHERE has_emails) as new_domains_with_emails
)
SELECT 
    'New domains added: ' || new_domains_added || 
    ' (' || new_domains_with_emails || ' with emails)' || 
    ', Existing domains updated: ' || domains_updated as summary
FROM stats;

COMMIT;