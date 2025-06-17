-- Create views for employer domain coverage dashboard
-- These views provide insights into which employers have domains and emails

-- Drop existing views if they exist
DROP VIEW IF EXISTS employer_search_queue CASCADE;
DROP VIEW IF EXISTS employer_domain_coverage CASCADE;

-- Create unified employer view with domain coverage
CREATE VIEW employer_domain_coverage AS
SELECT 
    e.id as employer_id,
    e.name as employer_name,
    -- Count active jobs
    COUNT(DISTINCT j.refnr) as total_jobs,
    COUNT(DISTINCT CASE WHEN j.is_active = true THEN j.refnr END) as active_jobs,
    COUNT(DISTINCT CASE WHEN j.externeurl IS NOT NULL THEN j.refnr END) as jobs_with_external_url,
    MAX(j.aktuelleveroeffentlichungsdatum) as latest_job_date,
    MIN(j.eintrittsdatum) as earliest_start_date,
    
    -- Get most common location for this employer
    (SELECT arbeitsort_plz || ' ' || arbeitsort_ort
     FROM job_scrp_arbeitsagentur_jobs_v2 
     WHERE arbeitgeber = e.name 
     GROUP BY arbeitsort_plz, arbeitsort_ort
     ORDER BY COUNT(*) DESC 
     LIMIT 1) as primary_location,
    
    -- Get full address from most recent job
    (SELECT CONCAT(
        COALESCE(arbeitsort_strasse, ''), 
        CASE WHEN arbeitsort_strasse IS NOT NULL THEN ', ' ELSE '' END,
        COALESCE(arbeitsort_plz, ''), ' ', 
        COALESCE(arbeitsort_ort, ''))
     FROM job_scrp_arbeitsagentur_jobs_v2 
     WHERE arbeitgeber = e.name 
       AND arbeitsort_plz IS NOT NULL
     ORDER BY aktuelleveroeffentlichungsdatum DESC 
     LIMIT 1) as employer_address,
    
    -- Get postal code for searching
    (SELECT arbeitsort_plz
     FROM job_scrp_arbeitsagentur_jobs_v2 
     WHERE arbeitgeber = e.name 
       AND arbeitsort_plz IS NOT NULL
     GROUP BY arbeitsort_plz
     ORDER BY COUNT(*) DESC
     LIMIT 1) as primary_plz,
    
    -- Check if we have Google search results
    EXISTS(
        SELECT 1 
        FROM google_domains_service gds
        WHERE (
            -- Exact match
            lower(gds.query_company_name) = lower(e.name)
            -- Or fuzzy match using pg_trgm
            OR similarity(gds.company_name_normalized, normalize_company_name(e.name)) > 0.7
        )
    ) as has_google_search,
    
    -- Get best matching verified domain
    (SELECT gds.result_domain
     FROM google_domains_service gds
     WHERE (
         lower(gds.query_company_name) = lower(e.name)
         OR similarity(gds.company_name_normalized, normalize_company_name(e.name)) > 0.7
     )
     AND gds.is_verified = true
     AND gds.domain_confidence >= 0.7
     ORDER BY 
         CASE WHEN lower(gds.query_company_name) = lower(e.name) THEN 1 ELSE 0 END DESC,
         similarity(gds.company_name_normalized, normalize_company_name(e.name)) DESC,
         gds.domain_confidence DESC
     LIMIT 1) as verified_domain,
    
    -- Count total domains found
    (SELECT COUNT(DISTINCT gds.result_domain)
     FROM google_domains_service gds
     WHERE (
         lower(gds.query_company_name) = lower(e.name)
         OR similarity(gds.company_name_normalized, normalize_company_name(e.name)) > 0.7
     )) as domains_found_count,
    
    -- Get emails
    (SELECT array_agg(DISTINCT email)
     FROM (
         SELECT unnest(gds.all_emails) as email
         FROM google_domains_service gds
         WHERE (
             lower(gds.query_company_name) = lower(e.name)
             OR similarity(gds.company_name_normalized, normalize_company_name(e.name)) > 0.7
         )
         AND gds.all_emails IS NOT NULL
     ) emails
     WHERE email IS NOT NULL AND email != '') as all_emails,
    
    -- Email extraction status from job_scrp_employers
    e.email_extraction_attempted,
    e.email_extraction_date,
    e.contact_emails as scraper_emails,
    e.website as scraper_website
    
FROM job_scrp_employers e
LEFT JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.arbeitgeber = e.name
GROUP BY e.id, e.name, e.email_extraction_attempted, e.email_extraction_date, e.contact_emails, e.website;

-- Create search priority queue
CREATE VIEW employer_search_queue AS
SELECT 
    employer_id,
    employer_name,
    employer_address,
    primary_plz,
    primary_location,
    active_jobs,
    total_jobs,
    latest_job_date,
    jobs_with_external_url,
    
    -- Calculate priority score
    CASE 
        -- Highest priority: Many active jobs, no domain
        WHEN active_jobs >= 10 AND verified_domain IS NULL THEN 1
        -- High priority: Active jobs, no Google search
        WHEN active_jobs >= 5 AND has_google_search = false THEN 2
        -- Medium priority: Recent jobs, no domain
        WHEN latest_job_date > CURRENT_DATE - INTERVAL '30 days' AND verified_domain IS NULL THEN 3
        -- Medium-low: Has jobs but old
        WHEN total_jobs > 0 AND has_google_search = false THEN 4
        -- Low priority: No recent activity
        ELSE 5
    END as priority,
    
    -- Calculate potential value score
    (
        active_jobs * 10 +  -- Active jobs are most valuable
        CASE WHEN latest_job_date > CURRENT_DATE - INTERVAL '7 days' THEN 50 ELSE 0 END +
        CASE WHEN jobs_with_external_url > 0 THEN 20 ELSE 0 END +
        total_jobs  -- Historical jobs add some value
    ) as value_score,
    
    has_google_search,
    verified_domain,
    CASE 
        WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN true 
        ELSE false 
    END as has_emails

FROM employer_domain_coverage
WHERE employer_address IS NOT NULL  -- Must have an address to search
ORDER BY 
    priority ASC, 
    value_score DESC, 
    active_jobs DESC;

-- Create summary statistics view
CREATE VIEW employer_coverage_stats AS
SELECT 
    COUNT(*) as total_employers,
    COUNT(CASE WHEN primary_plz IS NOT NULL THEN 1 END) as with_address,
    COUNT(CASE WHEN has_google_search = true THEN 1 END) as with_google_search,
    COUNT(CASE WHEN verified_domain IS NOT NULL THEN 1 END) as with_verified_domain,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as with_emails,
    COUNT(CASE WHEN active_jobs > 0 THEN 1 END) as with_active_jobs,
    COUNT(CASE WHEN has_google_search = false AND primary_plz IS NOT NULL THEN 1 END) as pending_search,
    
    -- Calculate percentages
    ROUND(100.0 * COUNT(CASE WHEN has_google_search = true THEN 1 END) / NULLIF(COUNT(*), 0), 2) as search_coverage_pct,
    ROUND(100.0 * COUNT(CASE WHEN verified_domain IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0), 2) as domain_coverage_pct,
    ROUND(100.0 * COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as email_coverage_pct
    
FROM employer_domain_coverage;

-- Create PLZ-based coverage view
CREATE VIEW plz_coverage_stats AS
SELECT 
    substring(primary_plz from 1 for 2) as plz_region,
    COUNT(DISTINCT employer_id) as total_employers,
    COUNT(DISTINCT CASE WHEN has_google_search = true THEN employer_id END) as searched_employers,
    COUNT(DISTINCT CASE WHEN verified_domain IS NOT NULL THEN employer_id END) as with_domain,
    COUNT(DISTINCT CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN employer_id END) as with_emails,
    SUM(active_jobs) as total_active_jobs,
    
    -- Coverage percentages
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN has_google_search = true THEN employer_id END) / NULLIF(COUNT(DISTINCT employer_id), 0), 2) as search_coverage_pct
    
FROM employer_domain_coverage
WHERE primary_plz IS NOT NULL
GROUP BY substring(primary_plz from 1 for 2)
ORDER BY total_active_jobs DESC;

-- Create time-based activity view
CREATE VIEW google_search_activity AS
SELECT 
    DATE(created_at) as activity_date,
    query_source,
    COUNT(*) as searches_performed,
    COUNT(CASE WHEN is_verified = true THEN 1 END) as domains_verified,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as emails_found,
    COUNT(DISTINCT query_company_name) as unique_companies
FROM google_domains_service
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at), query_source
ORDER BY activity_date DESC, searches_performed DESC;

-- Create index to improve performance
CREATE INDEX IF NOT EXISTS idx_google_domains_company_normalized 
ON google_domains_service(company_name_normalized);

CREATE INDEX IF NOT EXISTS idx_google_domains_query_company_lower 
ON google_domains_service(lower(query_company_name));

-- Verification query to check coverage
SELECT 
    'Overall Coverage' as metric,
    total_employers,
    with_google_search,
    with_verified_domain,
    with_emails,
    pending_search,
    search_coverage_pct || '%' as search_coverage,
    domain_coverage_pct || '%' as domain_coverage,
    email_coverage_pct || '%' as email_coverage
FROM employer_coverage_stats;