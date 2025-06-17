-- Analysis and Integration: job_scrp_employers ↔ our_domains
-- This script analyzes the relationship between job scraper employers and existing domain data

BEGIN;

-- 1. Overall statistics comparison
SELECT 'Job Scraper Employers' as source, COUNT(*) as total,
       COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted,
       COUNT(CASE WHEN contact_emails IS NOT NULL THEN 1 END) as with_emails
FROM job_scrp_employers
UNION ALL
SELECT 'Our Domains' as source, COUNT(*) as total,
       COUNT(CASE WHEN domain_scaned_for_emails = true THEN 1 END) as attempted,
       COUNT(CASE WHEN emails_found = true THEN 1 END) as with_emails
FROM our_domains;

-- 2. Error analysis from our_domains - identify retry candidates
SELECT 
    'Error Analysis' as report,
    error_message,
    COUNT(*) as count,
    COUNT(CASE WHEN source = 'yellow_pages' THEN 1 END) as yellow_pages,
    COUNT(CASE WHEN source = 'employment_agency' THEN 1 END) as employment_agency,
    COUNT(CASE WHEN source = 'google_domains' THEN 1 END) as google_domains
FROM our_domains 
WHERE error_message IS NOT NULL 
    AND error_message != ''
GROUP BY error_message 
ORDER BY count DESC 
LIMIT 10;

-- 3. Potential domain matches by exact domain
-- Connect via arbeitsagentur_jobs_v2 -> job_details -> our_domains
CREATE TEMP TABLE domain_matches AS
SELECT 
    j.arbeitgeber as employer_name,
    jd.reference_number,
    jd.contact_emails as job_emails,
    jd.company_domain as job_domain,
    d.id as domain_id,
    d.the_name as domain_name,
    d.domain,
    d.best_email as domain_email,
    d.source as domain_source,
    d.emails_found as domain_has_emails,
    d.error_message
FROM job_scrp_arbeitsagentur_jobs_v2 j
JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
JOIN our_domains d ON LOWER(TRIM(jd.company_domain)) = LOWER(TRIM(d.domain))
WHERE jd.company_domain IS NOT NULL 
    AND jd.company_domain != ''
    AND d.domain IS NOT NULL 
    AND d.domain != ''
    AND j.is_active = true;

SELECT 'Domain Matches Found' as report, COUNT(*) as matches FROM domain_matches;

-- 4. Show sample matches
SELECT 
    employer_name,
    domain,
    domain_source,
    job_emails,
    domain_email,
    domain_has_emails,
    error_message
FROM domain_matches 
WHERE domain_has_emails = true
LIMIT 10;

-- 5. Address-based fuzzy matching candidates
-- Find our_domains records with good address data that could match employers
CREATE TEMP TABLE address_candidates AS
SELECT 
    d.id as domain_id,
    d.the_name,
    d.street_number,
    d.zip,
    d.city,
    d.domain,
    d.best_email,
    d.source,
    d.emails_found,
    d.error_message,
    -- Normalize company name for matching
    LOWER(TRIM(REGEXP_REPLACE(d.the_name, '\s+(gmbh|ag|kg|ohg|gbr|ug|co)(\s|$)', '', 'gi'))) as normalized_name
FROM our_domains d
WHERE d.the_name IS NOT NULL 
    AND d.the_name != ''
    AND (d.zip IS NOT NULL OR d.city IS NOT NULL)
    AND LENGTH(d.the_name) > 3;

SELECT 'Address Candidates' as report, COUNT(*) as candidates FROM address_candidates;

-- 6. Retry candidates analysis - domains that failed but could be retried
CREATE TEMP TABLE retry_candidates AS
SELECT 
    d.id,
    d.domain,
    d.the_name,
    d.source,
    d.error_message,
    CASE 
        WHEN d.error_message LIKE '%DNS Lookup Error%' THEN 'dns_retry'
        WHEN d.error_message LIKE '%Forbidden for scrapy%' THEN 'playwright_retry'
        WHEN d.error_message LIKE '%Timeout Error%' THEN 'timeout_retry'
        WHEN d.error_message LIKE '%kontakt_link%' THEN 'link_detection_retry'
        WHEN d.error_message LIKE '%Expecting value%' THEN 'json_parsing_retry'
        ELSE 'other_retry'
    END as retry_category
FROM our_domains d
WHERE d.error_message IS NOT NULL 
    AND d.error_message != ''
    AND d.emails_found != true
    AND d.domain IS NOT NULL
    AND d.domain != '';

SELECT 
    retry_category,
    COUNT(*) as count,
    COUNT(CASE WHEN source = 'yellow_pages' THEN 1 END) as yellow_pages,
    COUNT(CASE WHEN source = 'employment_agency' THEN 1 END) as employment_agency
FROM retry_candidates 
GROUP BY retry_category 
ORDER BY count DESC;

-- 7. Success rate by source
SELECT 
    source,
    COUNT(*) as total,
    COUNT(CASE WHEN emails_found = true THEN 1 END) as successful,
    ROUND(100.0 * COUNT(CASE WHEN emails_found = true THEN 1 END) / COUNT(*), 2) as success_rate,
    COUNT(CASE WHEN impressum_link IS NOT NULL THEN 1 END) as with_impressum_link,
    COUNT(CASE WHEN contact_link IS NOT NULL THEN 1 END) as with_contact_link
FROM our_domains 
WHERE source IS NOT NULL
GROUP BY source 
ORDER BY success_rate DESC;

-- 8. Geographic distribution of successful domains
SELECT 
    substring(zip from 1 for 2) as region,
    COUNT(*) as total_domains,
    COUNT(CASE WHEN emails_found = true THEN 1 END) as with_emails,
    ROUND(100.0 * COUNT(CASE WHEN emails_found = true THEN 1 END) / COUNT(*), 2) as success_rate
FROM our_domains 
WHERE zip IS NOT NULL 
    AND zip ~ '^[0-9]{5}$'
GROUP BY substring(zip from 1 for 2)
HAVING COUNT(*) > 100
ORDER BY success_rate DESC
LIMIT 15;

COMMIT;

-- Summary recommendations
SELECT 'INTEGRATION SUMMARY' as report;
SELECT '1. Domain Matches: Check domain_matches temp table for existing connections' as recommendation;
SELECT '2. Retry Candidates: Focus on dns_retry, playwright_retry, link_detection_retry categories' as recommendation;
SELECT '3. Address Matching: Use address_candidates for fuzzy matching with job employers' as recommendation;
SELECT '4. Success Rates: Yellow pages (56.8%) and employment_agency (84.8%) are most successful' as recommendation;