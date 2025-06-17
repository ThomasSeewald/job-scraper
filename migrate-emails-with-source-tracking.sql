-- Enhanced Email Migration Script: Transfer emails from old database with source tracking
-- This preserves the distinction between detail page emails vs Google Search API emails

-- Step 1: Add new columns to job_details table to track email sources
ALTER TABLE job_details 
ADD COLUMN IF NOT EXISTS detail_page_email character varying,
ADD COLUMN IF NOT EXISTS google_search_email character varying,
ADD COLUMN IF NOT EXISTS detail_page_website character varying,
ADD COLUMN IF NOT EXISTS google_search_website character varying,
ADD COLUMN IF NOT EXISTS email_source character varying; -- 'detail_page', 'google_search', or 'both'

-- Step 2: Create backup of current job_details table (optional but recommended)
-- CREATE TABLE job_details_backup AS SELECT * FROM job_details;

-- Step 3: Insert/Update job_details with emails from old database, preserving sources
INSERT INTO job_details (
  reference_number,
  detail_page_email,
  google_search_email,
  detail_page_website,
  google_search_website,
  best_email,
  company_domain,
  email_source,
  scraping_success,
  scraped_at,
  email_count
)
SELECT 
  new.refnr as reference_number,
  -- Detail page email (from detail page scraping)
  CASE 
    WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email 
    ELSE NULL 
  END as detail_page_email,
  -- Google search email (from Google Search API)
  CASE 
    WHEN old.new_email LIKE '%@%' THEN old.new_email 
    ELSE NULL 
  END as google_search_email,
  -- Detail page website
  CASE 
    WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      regexp_replace(old.website, '^https?://(www\.)?', '') 
    ELSE NULL 
  END as detail_page_website,
  -- Google search website
  CASE 
    WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' THEN 
      regexp_replace(old.new_website, '^https?://(www\.)?', '') 
    ELSE NULL 
  END as google_search_website,
  -- Best email (priority: Google search > Detail page > best_email field)
  COALESCE(
    CASE WHEN old.new_email LIKE '%@%' THEN old.new_email END,
    CASE WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email END,
    CASE WHEN old.best_email LIKE '%@%' THEN old.best_email END
  ) as best_email,
  -- Best domain (priority: Google search > Detail page)
  COALESCE(
    CASE WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' THEN 
      regexp_replace(old.new_website, '^https?://(www\.)?', '') 
    END,
    CASE WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      regexp_replace(old.website, '^https?://(www\.)?', '') 
    END
  ) as company_domain,
  -- Email source tracking
  CASE 
    WHEN old.new_email LIKE '%@%' AND old.email LIKE '%@%' AND old.email != 'keine' THEN 'both'
    WHEN old.new_email LIKE '%@%' THEN 'google_search'
    WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN 'detail_page'
    WHEN old.best_email LIKE '%@%' THEN 'unknown'
    ELSE 'none'
  END as email_source,
  true as scraping_success,
  NOW() as scraped_at,
  CASE 
    WHEN old.new_email LIKE '%@%' AND old.email LIKE '%@%' AND old.email != 'keine' THEN 2
    WHEN old.new_email LIKE '%@%' OR (old.email LIKE '%@%' AND old.email != 'keine') THEN 1
    ELSE 0
  END as email_count
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
  detail_page_email = EXCLUDED.detail_page_email,
  google_search_email = EXCLUDED.google_search_email,
  detail_page_website = EXCLUDED.detail_page_website,
  google_search_website = EXCLUDED.google_search_website,
  best_email = EXCLUDED.best_email,
  company_domain = EXCLUDED.company_domain,
  email_source = EXCLUDED.email_source,
  scraping_success = EXCLUDED.scraping_success,
  scraped_at = EXCLUDED.scraped_at,
  email_count = EXCLUDED.email_count;

-- Step 4: Verify the migration with detailed source tracking
SELECT 
  email_source,
  COUNT(*) as count,
  COUNT(CASE WHEN detail_page_email IS NOT NULL THEN 1 END) as detail_page_emails,
  COUNT(CASE WHEN google_search_email IS NOT NULL THEN 1 END) as google_search_emails,
  COUNT(CASE WHEN best_email IS NOT NULL THEN 1 END) as total_emails
FROM job_details 
WHERE email_source IS NOT NULL
GROUP BY email_source
ORDER BY count DESC;

-- Step 5: Overall statistics
SELECT 
  COUNT(*) as total_job_details,
  COUNT(CASE WHEN best_email LIKE '%@%' THEN 1 END) as records_with_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL THEN 1 END) as detail_page_emails,
  COUNT(CASE WHEN google_search_email IS NOT NULL THEN 1 END) as google_search_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL AND google_search_email IS NOT NULL THEN 1 END) as both_sources,
  COUNT(CASE WHEN company_domain IS NOT NULL THEN 1 END) as records_with_domains
FROM job_details;

-- Step 6: Test the migrated data with source information
SELECT 
  jd.reference_number,
  j.arbeitgeber as employer,
  j.arbeitsort_ort as city,
  jd.detail_page_email,
  jd.google_search_email,
  jd.best_email,
  jd.email_source,
  jd.company_domain
FROM job_details jd
INNER JOIN arbeitsagentur_jobs_v2 j ON jd.reference_number = j.refnr
WHERE jd.best_email LIKE '%@%'
ORDER BY jd.email_source, jd.reference_number
LIMIT 20;

-- Step 7: Test the Dresden search with migrated data
SELECT 
  arbeitgeber,
  MAX(arbeitsort_plz) AS postal_code,
  MAX(arbeitsort_ort) AS city, 
  MAX(beruf) AS occupation,
  MAX(arbeitsort_region) AS region,
  COUNT(arbeitgeber) AS employer_count,
  MAX(refnr) AS referencenumber,
  COALESCE(
    MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email ELSE NULL END),
    ''
  ) AS email,
  MAX(jd.email_source) AS email_source,
  MAX(jd.company_domain) AS website,
  MAX(6371 * acos(
    cos(radians(49.4389045835822)) * 
    cos(radians(arbeitsort_koordinaten_lat)) * 
    cos(radians(arbeitsort_koordinaten_lon) - radians(7.76943564717589)) + 
    sin(radians(49.4389045835822)) * 
    sin(radians(arbeitsort_koordinaten_lat))
  )) AS distance
FROM arbeitsagentur_jobs_v2 j
LEFT JOIN job_details jd ON j.refnr = jd.reference_number
WHERE 
  j.is_active = true
  AND (length(externeurl) < 20 OR externeurl IS NULL)
  AND arbeitsort_koordinaten_lat IS NOT NULL 
  AND arbeitsort_koordinaten_lon IS NOT NULL
GROUP BY arbeitgeber 
HAVING MAX(6371 * acos(
  cos(radians(49.4389045835822)) * 
  cos(radians(arbeitsort_koordinaten_lat)) * 
  cos(radians(arbeitsort_koordinaten_lon) - radians(7.76943564717589)) + 
  sin(radians(49.4389045835822)) * 
  sin(radians(arbeitsort_koordinaten_lat))
)) < 4
AND COALESCE(
  MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email ELSE NULL END),
  ''
) LIKE '%@%'
ORDER BY email ASC;