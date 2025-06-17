-- Clean up duplicate records in our_google_domains_service
-- Keep only the best record per company (highest confidence, most emails)

BEGIN;

-- Show current statistics
SELECT 
    'Before cleanup' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT query_company_name) as unique_companies
FROM our_google_domains_service;

-- Create a backup of what we're about to delete (optional)
CREATE TEMP TABLE deleted_duplicates AS
SELECT *
FROM our_google_domains_service 
WHERE id NOT IN (
    SELECT DISTINCT ON (query_company_name) id
    FROM our_google_domains_service
    ORDER BY query_company_name, 
             -- Prioritize records with highest confidence and most emails
             CASE WHEN domain_confidence IS NOT NULL THEN domain_confidence ELSE 0 END DESC,
             CASE WHEN all_emails IS NOT NULL THEN array_length(all_emails, 1) ELSE 0 END DESC,
             is_verified DESC,
             created_at DESC
);

-- Show what will be deleted
SELECT 
    'Records to be deleted' as status,
    COUNT(*) as count
FROM deleted_duplicates;

-- Perform the cleanup - delete duplicates
DELETE FROM our_google_domains_service 
WHERE id NOT IN (
    SELECT DISTINCT ON (query_company_name) id
    FROM our_google_domains_service
    ORDER BY query_company_name, 
             -- Prioritize records with highest confidence and most emails
             CASE WHEN domain_confidence IS NOT NULL THEN domain_confidence ELSE 0 END DESC,
             CASE WHEN all_emails IS NOT NULL THEN array_length(all_emails, 1) ELSE 0 END DESC,
             is_verified DESC,
             created_at DESC
);

-- Show results after cleanup
SELECT 
    'After cleanup' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT query_company_name) as unique_companies,
    COUNT(CASE WHEN all_emails IS NOT NULL AND array_length(all_emails, 1) > 0 THEN 1 END) as with_emails
FROM our_google_domains_service;

-- Show top companies that had duplicates removed
SELECT 
    dd.query_company_name,
    COUNT(*) as duplicates_removed
FROM deleted_duplicates dd
GROUP BY dd.query_company_name
ORDER BY COUNT(*) DESC
LIMIT 10;

COMMIT;

-- Final verification - check for any remaining duplicates
SELECT 
    query_company_name,
    COUNT(*) as count
FROM our_google_domains_service 
GROUP BY query_company_name 
HAVING COUNT(*) > 1 
ORDER BY COUNT(*) DESC 
LIMIT 5;