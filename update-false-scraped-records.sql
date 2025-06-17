-- Update records that were incorrectly marked as successfully scraped
-- These are likely cases where CAPTCHA was shown but not solved

-- First, let's see what we're about to update
SELECT 
    COUNT(*) as total_to_update,
    MIN(scraped_at) as earliest_record,
    MAX(scraped_at) as latest_record
FROM job_scrp_job_details 
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '')
    AND captcha_solved = false;

-- Show some sample records that will be updated
SELECT 
    reference_number,
    scraped_at,
    captcha_solved,
    scraping_success,
    scraping_error
FROM job_scrp_job_details 
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '')
    AND captcha_solved = false
ORDER BY scraped_at DESC
LIMIT 10;

-- Update these records to mark them as not successfully scraped
BEGIN;

UPDATE job_scrp_job_details 
SET 
    scraping_success = false,
    scraping_error = 'CAPTCHA likely blocked content - needs re-scraping',
    updated_at = CURRENT_TIMESTAMP
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '')
    AND captcha_solved = false;

-- Show how many records were updated
GET DIAGNOSTICS updated_count = ROW_COUNT;
SELECT updated_count as records_updated;

COMMIT;

-- Verify the update
SELECT 
    COUNT(*) as total_failed_records,
    COUNT(CASE WHEN scraping_error LIKE '%CAPTCHA likely blocked%' THEN 1 END) as captcha_blocked
FROM job_scrp_job_details 
WHERE scraping_success = false;