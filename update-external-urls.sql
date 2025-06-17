-- Update external URLs in job_scrp_arbeitsagentur_jobs_v2 from our_sql_employment_agency
-- Match by reference_number -> refnr

BEGIN;

-- First, let's see how many matches we'll update
SELECT COUNT(*) as jobs_to_update
FROM job_scrp_arbeitsagentur_jobs_v2 j
INNER JOIN our_sql_employment_agency o ON j.refnr = o.reference_number
WHERE o.external_url IS NOT NULL 
  AND o.external_url != ''
  AND (j.externeurl IS NULL OR j.externeurl = '');

-- Update the external URLs
UPDATE job_scrp_arbeitsagentur_jobs_v2 j
SET externeurl = o.external_url
FROM our_sql_employment_agency o
WHERE j.refnr = o.reference_number
  AND o.external_url IS NOT NULL 
  AND o.external_url != ''
  AND (j.externeurl IS NULL OR j.externeurl = '');

-- Show results
SELECT 
    COUNT(*) FILTER (WHERE externeurl IS NOT NULL AND externeurl != '') as jobs_with_external_urls,
    COUNT(*) FILTER (WHERE externeurl IS NULL OR externeurl = '') as jobs_without_external_urls,
    MIN(LENGTH(externeurl)) as min_url_length,
    MAX(LENGTH(externeurl)) as max_url_length
FROM job_scrp_arbeitsagentur_jobs_v2;

COMMIT;