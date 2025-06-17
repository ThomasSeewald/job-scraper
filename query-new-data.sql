-- Query to find new incoming data (old = false)
-- This will show you all records imported after the 'old' column was added

-- Basic query for new records
SELECT 
    COUNT(*) as new_records_count
FROM arbeitsagentur_jobs_v2 
WHERE old = false;

-- Detailed view of new records with key information
SELECT 
    id,
    refnr,
    titel,
    arbeitgeber,
    arbeitsort_ort,
    arbeitsort_plz,
    aktuelleveroeffentlichungsdatum,
    created_at,
    externeurl,
    email,
    new_email
FROM arbeitsagentur_jobs_v2 
WHERE old = false
ORDER BY aktuelleveroeffentlichungsdatum DESC, id DESC
LIMIT 50;

-- Summary comparison of old vs new data
SELECT 
    old,
    COUNT(*) as record_count,
    COUNT(DISTINCT arbeitgeber) as unique_employers,
    COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) as with_external_urls,
    COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_old_emails,
    COUNT(CASE WHEN new_email IS NOT NULL AND new_email != '' THEN 1 END) as with_new_emails,
    MIN(aktuelleveroeffentlichungsdatum) as earliest_publication,
    MAX(aktuelleveroeffentlichungsdatum) as latest_publication
FROM arbeitsagentur_jobs_v2 
GROUP BY old
ORDER BY old;

-- New employers that need email extraction (from new data only)
SELECT 
    arbeitgeber,
    COUNT(*) as job_count,
    MAX(aktuelleveroeffentlichungsdatum) as latest_job_date,
    MAX(titel) as sample_job_title
FROM arbeitsagentur_jobs_v2 
WHERE old = false
    AND (externeurl IS NULL OR externeurl = '')
    AND (email IS NULL OR email = '')
    AND (new_email IS NULL OR new_email = '')
GROUP BY arbeitgeber
ORDER BY job_count DESC, latest_job_date DESC
LIMIT 20;