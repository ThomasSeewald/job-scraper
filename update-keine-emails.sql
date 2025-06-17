-- Update employers with "keine" in email field to mark as already attempted
-- This prevents them from being re-scraped unnecessarily

-- First, let's check how many records will be affected
SELECT COUNT(*) as employers_with_keine
FROM job_scrp_employers 
WHERE contact_emails = 'keine'
   OR contact_emails LIKE 'keine,%'
   OR contact_emails LIKE '%, keine'
   OR contact_emails LIKE '%, keine,%';

-- Update these employers to mark them as already attempted
UPDATE job_scrp_employers 
SET 
    email_extraction_attempted = true,
    email_extraction_date = COALESCE(email_extraction_date, NOW()),
    notes = COALESCE(notes, '') || ' [Marked as attempted - contains "keine"]',
    last_updated = NOW()
WHERE (contact_emails = 'keine'
   OR contact_emails LIKE 'keine,%'
   OR contact_emails LIKE '%, keine'
   OR contact_emails LIKE '%, keine,%')
   AND (email_extraction_attempted = false OR email_extraction_attempted IS NULL);

-- Verify the update
SELECT 
    COUNT(*) as total_keine_employers,
    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as marked_as_attempted,
    COUNT(CASE WHEN email_extraction_attempted = false OR email_extraction_attempted IS NULL THEN 1 END) as not_yet_marked
FROM job_scrp_employers 
WHERE contact_emails = 'keine'
   OR contact_emails LIKE 'keine,%'
   OR contact_emails LIKE '%, keine'
   OR contact_emails LIKE '%, keine,%';

-- Also update the selection queries to exclude "keine" emails
-- This is the corrected query for selecting employers to scrape:
/*
WITH employer_newest_jobs AS (
    SELECT 
        e.id,
        e.name,
        e.normalized_name,
        j.refnr,
        j.titel,
        j.arbeitsort_ort,
        j.arbeitsort_plz,
        j.aktuelleveroeffentlichungsdatum,
        ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY j.aktuelleveroeffentlichungsdatum DESC) as rn
    FROM job_scrp_employers e
    INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
    WHERE (e.email_extraction_attempted = false OR e.email_extraction_attempted IS NULL)
        AND (e.contact_emails IS NULL OR e.contact_emails = '' OR e.contact_emails = 'keine')
        AND (e.website IS NULL OR e.website = '')
        AND (j.externeurl IS NULL OR j.externeurl = '')
        AND j.refnr IS NOT NULL
        AND j.is_active = true
)
SELECT 
    id,
    name,
    normalized_name,
    refnr,
    titel,
    arbeitsort_ort,
    arbeitsort_plz,
    aktuelleveroeffentlichungsdatum
FROM employer_newest_jobs 
WHERE rn = 1
ORDER BY aktuelleveroeffentlichungsdatum DESC
LIMIT 25000;
*/