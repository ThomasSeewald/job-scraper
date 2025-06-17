-- Database optimization script for job scraper dashboard
-- Run this to improve query performance

-- Index for main jobs table filtering and sorting
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_active_scraped 
ON arbeitsagentur_jobs_v2 (is_active, scraped_at DESC) 
WHERE is_active = true;

-- Index for PLZ filtering
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_plz 
ON arbeitsagentur_jobs_v2 (arbeitsort_plz) 
WHERE is_active = true;

-- Index for text search on common fields
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_search 
ON arbeitsagentur_jobs_v2 USING gin(
    to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(arbeitgeber, '') || ' ' || coalesce(beruf, ''))
) WHERE is_active = true;

-- Index for external URLs analysis
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_external_url 
ON arbeitsagentur_jobs_v2 (externeurl) 
WHERE is_active = true AND externeurl IS NOT NULL AND externeurl != '';

-- Index for job details join
CREATE INDEX IF NOT EXISTS idx_job_details_reference_number 
ON job_details (reference_number);

-- Index for job details filtering by email availability
CREATE INDEX IF NOT EXISTS idx_job_details_has_emails 
ON job_details (has_emails, scraped_at DESC);

-- Index for job details success tracking
CREATE INDEX IF NOT EXISTS idx_job_details_success 
ON job_details (scraping_success, scraped_at DESC);

-- Composite index for dashboard statistics
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_stats 
ON arbeitsagentur_jobs_v2 (is_active, old, data_source, scraped_at) 
WHERE is_active = true;

-- Index for employer analysis
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_arbeitgeber 
ON arbeitsagentur_jobs_v2 (arbeitgeber, is_active) 
WHERE is_active = true;

-- Analyze tables for query planner optimization
ANALYZE arbeitsagentur_jobs_v2;
ANALYZE job_details;

-- Show index usage statistics (for monitoring)
-- Note: Run this after the dashboard has been used for a while
/*
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
ORDER BY idx_tup_read DESC;
*/