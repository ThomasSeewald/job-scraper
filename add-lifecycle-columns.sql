-- Add job lifecycle tracking columns to arbeitsagentur_jobs_v2 table
-- This will help track when jobs were last seen in API and mark inactive jobs

BEGIN;

-- Add columns for lifecycle tracking
ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 
ADD COLUMN IF NOT EXISTS last_seen_in_api TIMESTAMP,
ADD COLUMN IF NOT EXISTS api_check_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS marked_inactive_date TIMESTAMP;

-- Create index for efficient querying of active jobs not seen recently
CREATE INDEX IF NOT EXISTS idx_jobs_lifecycle 
ON job_scrp_arbeitsagentur_jobs_v2 (is_active, last_seen_in_api) 
WHERE is_active = true;

-- Create index for old flag management
CREATE INDEX IF NOT EXISTS idx_jobs_old_status 
ON job_scrp_arbeitsagentur_jobs_v2 (old, aktuelleveroeffentlichungsdatum) 
WHERE old = false;

-- Update existing records to set initial last_seen_in_api
-- Set it to scraped_at for existing records
UPDATE job_scrp_arbeitsagentur_jobs_v2 
SET last_seen_in_api = scraped_at
WHERE last_seen_in_api IS NULL;

-- Function to mark jobs as inactive if not seen in API for 7 days
CREATE OR REPLACE FUNCTION mark_inactive_jobs()
RETURNS void AS $$
BEGIN
    UPDATE job_scrp_arbeitsagentur_jobs_v2
    SET 
        is_active = false,
        marked_inactive_date = CURRENT_TIMESTAMP,
        last_updated = CURRENT_TIMESTAMP
    WHERE 
        is_active = true 
        AND last_seen_in_api < CURRENT_TIMESTAMP - INTERVAL '7 days';
        
    -- Also mark jobs as old if they are more than 7 days old
    UPDATE job_scrp_arbeitsagentur_jobs_v2
    SET 
        old = true,
        last_updated = CURRENT_TIMESTAMP
    WHERE 
        old = false 
        AND aktuelleveroeffentlichungsdatum < CURRENT_TIMESTAMP - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Create a view to see job lifecycle statistics
CREATE OR REPLACE VIEW job_lifecycle_stats AS
SELECT 
    COUNT(*) as total_jobs,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_jobs,
    COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_jobs,
    COUNT(CASE WHEN old = true THEN 1 END) as old_jobs,
    COUNT(CASE WHEN old = false THEN 1 END) as fresh_jobs,
    COUNT(CASE WHEN last_seen_in_api > CURRENT_TIMESTAMP - INTERVAL '1 day' THEN 1 END) as seen_last_24h,
    COUNT(CASE WHEN last_seen_in_api > CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 1 END) as seen_last_7d,
    COUNT(CASE WHEN marked_inactive_date IS NOT NULL THEN 1 END) as marked_inactive_count,
    MAX(last_seen_in_api) as most_recent_api_check
FROM job_scrp_arbeitsagentur_jobs_v2;

COMMIT;

-- Usage:
-- SELECT * FROM job_lifecycle_stats;
-- SELECT mark_inactive_jobs(); -- Run this periodically to clean up inactive jobs