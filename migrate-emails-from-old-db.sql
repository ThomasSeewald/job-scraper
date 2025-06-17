-- Email Migration Script: Transfer emails from old database to new database
-- Run this script to import 131,446 email addresses from the old employment agency data

-- Step 1: Create backup of current job_details table (optional)
-- CREATE TABLE job_details_backup AS SELECT * FROM job_details;

-- Step 2: Insert/Update job_details with emails from old database
INSERT INTO job_details (
  reference_number,
  best_email,
  company_domain,
  scraping_success,
  scraped_at,
  email_count
)
SELECT 
  new.refnr as reference_number,
  COALESCE(
    CASE WHEN old.new_email LIKE '%@%' THEN old.new_email END,
    CASE WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email END,
    CASE WHEN old.best_email LIKE '%@%' THEN old.best_email END
  ) as best_email,
  COALESCE(
    CASE WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' AND old.new_website NOT LIKE '%,%' THEN 
      regexp_replace(old.new_website, '^https?://(www\.)?', '') 
    END,
    CASE WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      regexp_replace(old.website, '^https?://(www\.)?', '') 
    END
  ) as company_domain,
  true as scraping_success,
  NOW() as scraped_at,
  1 as email_count
FROM our_sql_employment_agency old
INNER JOIN arbeitsagentur_jobs_v2 new ON old.reference_number = new.refnr
WHERE (old.email LIKE '%@%' OR old.new_email LIKE '%@%' OR old.best_email LIKE '%@%')
  AND COALESCE(
    CASE WHEN old.new_email LIKE '%@%' THEN old.new_email END,
    CASE WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email END,
    CASE WHEN old.best_email LIKE '%@%' THEN old.best_email END
  ) IS NOT NULL
ON CONFLICT (reference_number) 
DO UPDATE SET
  best_email = EXCLUDED.best_email,
  company_domain = EXCLUDED.company_domain,
  scraping_success = EXCLUDED.scraping_success,
  scraped_at = EXCLUDED.scraped_at,
  email_count = EXCLUDED.email_count;

-- Step 3: Verify the migration
SELECT 
  COUNT(*) as total_job_details,
  COUNT(CASE WHEN best_email LIKE '%@%' THEN 1 END) as records_with_emails,
  COUNT(CASE WHEN company_domain IS NOT NULL THEN 1 END) as records_with_domains
FROM job_details;

-- Step 4: Test the migrated data with a sample query
SELECT 
  jd.reference_number,
  j.arbeitgeber as employer,
  j.arbeitsort_ort as city,
  jd.best_email,
  jd.company_domain
FROM job_details jd
INNER JOIN arbeitsagentur_jobs_v2 j ON jd.reference_number = j.refnr
WHERE jd.best_email LIKE '%@%'
LIMIT 10;