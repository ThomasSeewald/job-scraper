-- Fix column constraints and re-run migration
-- Step 1: Increase column limits to handle longer domains
ALTER TABLE job_details ALTER COLUMN company_domain TYPE character varying(500);

-- Step 2: Check for long domains/emails in old database before migration
WITH data_check AS (
  SELECT 
    reference_number,
    COALESCE(
      CASE WHEN new_email LIKE '%@%' THEN new_email END,
      CASE WHEN email LIKE '%@%' AND email != 'keine' THEN email END,
      CASE WHEN best_email LIKE '%@%' THEN best_email END
    ) as email_to_use,
    COALESCE(
      CASE WHEN new_website IS NOT NULL AND new_website != 'keine' THEN 
        SUBSTRING(regexp_replace(new_website, '^https?://(www\.)?', '') FROM 1 FOR 400)
      END,
      CASE WHEN website IS NOT NULL AND website != 'keine' AND website NOT LIKE '%,%' THEN 
        SUBSTRING(regexp_replace(website, '^https?://(www\.)?', '') FROM 1 FOR 400)
      END
    ) as domain_to_use
  FROM our_sql_employment_agency
  WHERE (email LIKE '%@%' OR new_email LIKE '%@%' OR best_email LIKE '%@%')
)
SELECT 
  COUNT(*) as total_records,
  COUNT(CASE WHEN LENGTH(email_to_use) > 255 THEN 1 END) as long_emails,
  COUNT(CASE WHEN LENGTH(domain_to_use) > 100 THEN 1 END) as long_domains,
  MAX(LENGTH(email_to_use)) as max_email_length,
  MAX(LENGTH(domain_to_use)) as max_domain_length
FROM data_check;

-- Step 3: Clear any existing partial data
DELETE FROM job_details WHERE email_source IS NOT NULL;

-- Step 4: Perform the migration with truncated values for safety
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
  -- Best domain (priority: Google search > Detail page, truncated to 400 chars)
  SUBSTRING(COALESCE(
    CASE WHEN old.new_website IS NOT NULL AND old.new_website != 'keine' THEN 
      regexp_replace(old.new_website, '^https?://(www\.)?', '') 
    END,
    CASE WHEN old.website IS NOT NULL AND old.website != 'keine' AND old.website NOT LIKE '%,%' THEN 
      regexp_replace(old.website, '^https?://(www\.)?', '') 
    END
  ) FROM 1 FOR 400) as company_domain,
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
  ) IS NOT NULL;

-- Step 5: Verify the migration with detailed source tracking
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

-- Step 6: Overall statistics
SELECT 
  COUNT(*) as total_job_details,
  COUNT(CASE WHEN best_email LIKE '%@%' THEN 1 END) as records_with_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL THEN 1 END) as detail_page_emails,
  COUNT(CASE WHEN google_search_email IS NOT NULL THEN 1 END) as google_search_emails,
  COUNT(CASE WHEN detail_page_email IS NOT NULL AND google_search_email IS NOT NULL THEN 1 END) as both_sources,
  COUNT(CASE WHEN company_domain IS NOT NULL THEN 1 END) as records_with_domains
FROM job_details;