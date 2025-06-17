-- Reset records that were incorrectly marked as successfully scraped
-- These are likely cases where CAPTCHA was shown but not solved

-- First, let's see what we're about to reset
SELECT 
    COUNT(*) as total_to_reset,
    MIN(scraped_at) as earliest_record,
    MAX(scraped_at) as latest_record
FROM job_scrp_job_details 
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '')
    AND captcha_solved = false;

-- Show some sample records that will be reset
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
LIMIT 20;

-- Reset these records by deleting them from job_details
-- This will allow them to be re-scraped
BEGIN;

DELETE FROM job_scrp_job_details 
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '')
    AND captcha_solved = false;

-- Show how many records were deleted
GET DIAGNOSTICS;

COMMIT;

-- Verify the deletion
SELECT COUNT(*) as remaining_false_positives
FROM job_scrp_job_details 
WHERE scraping_success = true 
    AND (contact_emails IS NULL OR contact_emails = '') 
    AND (best_email IS NULL OR best_email = '');