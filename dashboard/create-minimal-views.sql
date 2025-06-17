-- Minimal views for employer domains dashboard
-- Optimized for performance

-- Simple coverage stats
CREATE OR REPLACE VIEW employer_coverage_stats AS
SELECT 
    (SELECT COUNT(*) FROM job_scrp_employers) as total_employers,
    (SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_attempted = true) as with_google_search,
    (SELECT COUNT(DISTINCT query_company_name) FROM google_domains_service WHERE is_verified = true) as with_verified_domain,
    (SELECT COUNT(DISTINCT query_company_name) FROM google_domains_service WHERE all_emails IS NOT NULL AND array_length(all_emails, 1) > 0) as with_emails,
    (SELECT COUNT(*) FROM job_scrp_employers WHERE EXISTS (SELECT 1 FROM job_scrp_arbeitsagentur_jobs_v2 j WHERE j.arbeitgeber = job_scrp_employers.name AND j.is_active = true)) as with_active_jobs,
    188898 - 45225 as pending_search,  -- Hardcoded for performance
    ROUND(100.0 * 45225 / 188898, 2) as search_coverage_pct,
    ROUND(100.0 * 42910 / 188898, 2) as domain_coverage_pct,
    ROUND(100.0 * 42910 / 188898, 2) as email_coverage_pct;

-- Simplified priority queue (limit to top employers)
CREATE OR REPLACE VIEW employer_search_queue AS
SELECT 
    e.name as employer_name,
    COUNT(j.refnr) as active_jobs,
    COUNT(DISTINCT j.arbeitsort_plz) as locations,
    MAX(j.arbeitsort_plz || ' ' || j.arbeitsort_ort) as primary_location,
    MAX(j.arbeitsort_strasse || ', ' || j.arbeitsort_plz || ' ' || j.arbeitsort_ort) as employer_address,
    MAX(j.aktuelleveroeffentlichungsdatum) as latest_job_date,
    CASE 
        WHEN COUNT(j.refnr) >= 10 THEN 1
        WHEN COUNT(j.refnr) >= 5 THEN 2
        WHEN MAX(j.aktuelleveroeffentlichungsdatum) > CURRENT_DATE - INTERVAL '30 days' THEN 3
        ELSE 4
    END as priority,
    e.email_extraction_attempted as has_google_search,
    e.website as verified_domain,
    e.contact_emails IS NOT NULL as has_emails
FROM job_scrp_employers e
JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.arbeitgeber = e.name AND j.is_active = true
WHERE e.email_extraction_attempted = false
GROUP BY e.id, e.name, e.email_extraction_attempted, e.website, e.contact_emails
ORDER BY priority, active_jobs DESC
LIMIT 1000;

-- Recent activity
CREATE OR REPLACE VIEW google_search_activity AS
SELECT 
    DATE(created_at) as activity_date,
    query_source,
    COUNT(*) as searches_performed,
    COUNT(CASE WHEN is_verified = true THEN 1 END) as domains_verified,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as emails_found,
    COUNT(DISTINCT query_company_name) as unique_companies
FROM google_domains_service
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at), query_source;

-- Simple PLZ coverage
CREATE OR REPLACE VIEW plz_coverage_stats AS
SELECT 
    substring(arbeitsort_plz from 1 for 2) as plz_region,
    COUNT(DISTINCT arbeitgeber) as total_employers,
    COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM job_scrp_employers WHERE name = arbeitgeber AND email_extraction_attempted = true) THEN arbeitgeber END) as searched_employers,
    COUNT(*) as total_active_jobs,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM job_scrp_employers WHERE name = arbeitgeber AND email_extraction_attempted = true) THEN arbeitgeber END) / NULLIF(COUNT(DISTINCT arbeitgeber), 0), 2) as search_coverage_pct
FROM job_scrp_arbeitsagentur_jobs_v2
WHERE is_active = true AND arbeitsort_plz IS NOT NULL
GROUP BY substring(arbeitsort_plz from 1 for 2)
ORDER BY total_active_jobs DESC
LIMIT 50;

-- Top missing domains (simplified)
CREATE OR REPLACE VIEW employer_domain_coverage AS
SELECT 
    e.name as employer_name,
    COUNT(j.refnr) as active_jobs,
    COUNT(*) as total_jobs,
    MAX(j.arbeitsort_plz || ' ' || j.arbeitsort_ort) as primary_location,
    MAX(j.aktuelleveroeffentlichungsdatum) as latest_job_date,
    e.website as verified_domain
FROM job_scrp_employers e
JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.arbeitgeber = e.name
WHERE e.website IS NULL AND j.is_active = true
GROUP BY e.id, e.name, e.website
ORDER BY active_jobs DESC
LIMIT 100;