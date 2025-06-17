-- Integration Summary Report
-- Shows the results of integrating job scraper data into our_domains

-- 1. Overall Integration Impact
SELECT '=== INTEGRATION SUMMARY ===' as report;

SELECT 
    'Total domains before integration' as metric,
    234308 as before,
    (SELECT COUNT(*) FROM our_domains) as after,
    (SELECT COUNT(*) FROM our_domains) - 234308 as change
UNION ALL
SELECT 
    'Employment agency domains' as metric,
    7068 as before,
    (SELECT COUNT(*) FROM our_domains WHERE source = 'employment_agency') as after,
    (SELECT COUNT(*) FROM our_domains WHERE source = 'employment_agency') - 7068 as change
UNION ALL
SELECT 
    'Employment agency with emails' as metric,
    5995 as before,
    (SELECT COUNT(*) FROM our_domains WHERE source = 'employment_agency' AND emails_found = true) as after,
    (SELECT COUNT(*) FROM our_domains WHERE source = 'employment_agency' AND emails_found = true) - 5995 as change;

-- 2. New Domains by Email Status
SELECT '=== NEW DOMAINS ADDED ===' as report;
SELECT 
    CASE WHEN emails_found THEN 'With Emails' ELSE 'Without Emails' END as status,
    COUNT(*) as domains_added
FROM our_domains 
WHERE source = 'employment_agency' 
    AND create_date >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY emails_found
ORDER BY emails_found DESC;

-- 3. Top Employers Added
SELECT '=== TOP NEW EMPLOYERS BY JOB COUNT ===' as report;
WITH employer_stats AS (
    SELECT 
        d.the_name as employer,
        d.domain,
        d.best_email,
        COUNT(DISTINCT j.refnr) as active_jobs
    FROM our_domains d
    JOIN job_scrp_job_details jd ON LOWER(TRIM(d.domain)) = LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(jd.company_domain, '^https?://', ''), 
            '^www\.', ''
        )
    ))
    JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.refnr = jd.reference_number
    WHERE d.source = 'employment_agency'
        AND d.create_date >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
        AND j.is_active = true
    GROUP BY d.the_name, d.domain, d.best_email
)
SELECT 
    employer,
    domain,
    best_email,
    active_jobs
FROM employer_stats
ORDER BY active_jobs DESC
LIMIT 15;

-- 4. Geographic Coverage
SELECT '=== GEOGRAPHIC COVERAGE (TOP REGIONS) ===' as report;
SELECT 
    SUBSTRING(zip FROM 1 FOR 2) as plz_region,
    COUNT(*) as domains_added,
    COUNT(CASE WHEN emails_found THEN 1 END) as with_emails
FROM our_domains
WHERE source = 'employment_agency'
    AND create_date >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
    AND zip IS NOT NULL
GROUP BY SUBSTRING(zip FROM 1 FOR 2)
ORDER BY COUNT(*) DESC
LIMIT 10;

-- 5. Integration System Status
SELECT '=== INTEGRATION SYSTEM STATUS ===' as report;
SELECT 
    'Total employer-domain matches' as metric,
    COUNT(*) as count
FROM our_employer_domain_matches
UNION ALL
SELECT 
    'Verified matches (with emails)' as metric,
    COUNT(*) as count
FROM our_employer_domain_matches
WHERE status = 'verified' AND emails_found = true
UNION ALL
SELECT 
    'Domains in retry queue' as metric,
    COUNT(*) as count
FROM our_domains_retry_queue
WHERE status = 'queued';

-- 6. Email Coverage Improvement
SELECT '=== EMAIL COVERAGE IMPROVEMENT ===' as report;
WITH coverage_stats AS (
    SELECT 
        (SELECT COUNT(*) FROM job_scrp_employers WHERE contact_emails IS NOT NULL) as job_scraper_with_emails,
        (SELECT COUNT(*) FROM our_domains WHERE emails_found = true) as our_domains_with_emails,
        (SELECT COUNT(DISTINCT d.the_name) 
         FROM our_domains d 
         WHERE d.emails_found = true 
            AND EXISTS (
                SELECT 1 FROM job_scrp_employers e 
                WHERE LOWER(TRIM(e.name)) = LOWER(TRIM(d.the_name))
            )
        ) as matched_employers_with_emails
)
SELECT 
    'Job scraper employers with emails' as source,
    job_scraper_with_emails as count
FROM coverage_stats
UNION ALL
SELECT 
    'Our domains with emails' as source,
    our_domains_with_emails as count
FROM coverage_stats
UNION ALL
SELECT 
    'Potential matches with emails' as source,
    matched_employers_with_emails as count
FROM coverage_stats;

-- 7. Next Steps
SELECT '=== NEXT STEPS ===' as report;
SELECT 
    'Run domains retry scraper for ' || COUNT(*) || ' failed domains' as action
FROM our_domains_retry_queue WHERE status = 'queued'
UNION ALL
SELECT 
    'Process ' || COUNT(*) || ' high-priority retries (DNS/Scrapy blocks)' as action
FROM our_domains_retry_queue WHERE status = 'queued' AND priority <= 3
UNION ALL
SELECT 
    'Match remaining ' || COUNT(*) || ' employers without domains' as action
FROM job_scrp_employers e
WHERE NOT EXISTS (
    SELECT 1 FROM our_employer_domain_matches m 
    WHERE m.employer_name = e.name
);