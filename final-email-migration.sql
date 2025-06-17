-- Final Email Migration Script with proper view handling
-- Step 1: Save view definitions and drop them temporarily
DROP VIEW IF EXISTS job_details_summary CASCADE;
DROP VIEW IF EXISTS email_extraction_stats CASCADE;

-- Step 2: Alter column constraints
ALTER TABLE job_details ALTER COLUMN company_domain TYPE character varying(500);

-- Step 3: Clear any existing partial data from previous attempts
DELETE FROM job_details WHERE email_source IS NOT NULL;

-- Step 4: Perform the migration with proper truncation
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
  email_count,
  has_emails
)
SELECT 
  new.refnr as reference_number,
  -- Detail page email (from detail page scraping)
  CASE 
    WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN SUBSTRING(old.email FROM 1 FOR 255)
    ELSE NULL 
  END as detail_page_email,
  -- Google search email (from Google Search API)
  CASE 
    WHEN old.new_email LIKE '%@%' THEN SUBSTRING(old.new_email FROM 1 FOR 255)
    ELSE NULL 
  END as google_search_email,
  -- Detail page website (truncated)
  CASE 
    WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      SUBSTRING(regexp_replace(old.website, '^https?://(www\.)?', '') FROM 1 FOR 400)
    ELSE NULL 
  END as detail_page_website,
  -- Google search website (truncated)
  CASE 
    WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' THEN 
      SUBSTRING(regexp_replace(old.new_website, '^https?://(www\.)?', '') FROM 1 FOR 400)
    ELSE NULL 
  END as google_search_website,
  -- Best email (priority: Google search > Detail page > best_email field)
  SUBSTRING(COALESCE(
    CASE WHEN old.new_email LIKE '%@%' THEN old.new_email END,
    CASE WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email END,
    CASE WHEN old.best_email LIKE '%@%' THEN old.best_email END
  ) FROM 1 FOR 255) as best_email,
  -- Best domain (priority: Google search > Detail page, truncated to 500 chars)
  SUBSTRING(COALESCE(
    CASE WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' THEN 
      regexp_replace(old.new_website, '^https?://(www\.)?', '') 
    END,
    CASE WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      regexp_replace(old.website, '^https?://(www\.)?', '') 
    END
  ) FROM 1 FOR 500) as company_domain,
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
  END as email_count,
  true as has_emails
FROM our_sql_employment_agency old
INNER JOIN arbeitsagentur_jobs_v2 new ON old.reference_number = new.refnr
WHERE (old.email LIKE '%@%' OR old.new_email LIKE '%@%' OR old.best_email LIKE '%@%')
  AND COALESCE(
    CASE WHEN old.new_email LIKE '%@%' THEN old.new_email END,
    CASE WHEN old.email LIKE '%@%' AND old.email != 'keine' THEN old.email END,
    CASE WHEN old.best_email LIKE '%@%' THEN old.best_email END
  ) IS NOT NULL;

-- Step 5: Recreate the views
CREATE VIEW job_details_summary AS
SELECT j.refnr,
    j.titel,
    j.arbeitgeber,
    j.arbeitsort_ort,
    j.arbeitsort_plz,
    jd.contact_emails,
    jd.best_email,
    jd.company_domain,
    jd.has_emails,
    jd.email_count,
    jd.scraped_at AS detail_scraped_at,
    jd.scraping_success
FROM (arbeitsagentur_jobs_v2 j
     LEFT JOIN job_details jd ON (((j.refnr)::text = (jd.reference_number)::text)))
WHERE (j.is_active = true);

CREATE VIEW email_extraction_stats AS
SELECT count(*) AS total_jobs_scraped,
    count(
        CASE
            WHEN (best_email IS NOT NULL) THEN 1
            ELSE NULL::integer
        END) AS jobs_with_best_email,
    count(
        CASE
            WHEN (contact_emails IS NOT NULL) THEN 1
            ELSE NULL::integer
        END) AS jobs_with_any_emails,
    count(
        CASE
            WHEN (has_emails = true) THEN 1
            ELSE NULL::integer
        END) AS jobs_with_emails_flag,
    round(avg(email_count), 2) AS avg_emails_per_job,
    count(DISTINCT company_domain) AS unique_domains,
    round(avg(scraping_duration_ms), 0) AS avg_scraping_time_ms,
    count(
        CASE
            WHEN (captcha_solved = true) THEN 1
            ELSE NULL::integer
        END) AS captcha_solves,
    max(scraped_at) AS last_scrape_time
FROM job_details
WHERE (scraping_success = true);

-- Step 6: Verify the migration with detailed source tracking
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

-- Step 7: Overall statistics
SELECT 
  COUNT(*) as total_job_details,
  COUNT(CASE WHEN best_email LIKE '%@%' THEN 1 END) as records_with_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL THEN 1 END) as detail_page_emails,
  COUNT(CASE WHEN google_search_email IS NOT NULL THEN 1 END) as google_search_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL AND google_search_email IS NOT NULL THEN 1 END) as both_sources,
  COUNT(CASE WHEN company_domain IS NOT NULL THEN 1 END) as records_with_domains
FROM job_details;

-- Step 8: Test Dresden search to verify working results
SELECT 
  arbeitgeber,
  MAX(arbeitsort_plz) AS postal_code,
  MAX(arbeitsort_ort) AS city, 
  MAX(beruf) AS occupation,
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
ORDER BY email ASC
LIMIT 10;