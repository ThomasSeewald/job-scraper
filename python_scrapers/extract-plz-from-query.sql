-- Extract PLZ from query_full and populate query_postal_code
-- Looks for quoted postal codes like "12345" in the query_full field

BEGIN;

-- Show current status
SELECT 
    'Before PLZ extraction' as status,
    COUNT(*) as total_records,
    COUNT(CASE WHEN query_postal_code IS NOT NULL THEN 1 END) as with_plz,
    COUNT(CASE WHEN query_full ~ '"[0-9]{5}"' THEN 1 END) as with_quoted_plz_in_query
FROM our_google_domains_service;

-- Update records where query_postal_code is empty but query_full contains quoted PLZ
UPDATE our_google_domains_service 
SET query_postal_code = (
    -- Extract PLZ from quoted format like "12345"
    SELECT (regexp_match(query_full, '"([0-9]{5})"'))[1]
    WHERE query_full ~ '"[0-9]{5}"'
)
WHERE query_postal_code IS NULL 
    AND query_full ~ '"[0-9]{5}"';

-- Show results
SELECT 
    'After PLZ extraction' as status,
    COUNT(*) as total_records,
    COUNT(CASE WHEN query_postal_code IS NOT NULL THEN 1 END) as with_plz,
    COUNT(CASE WHEN query_full ~ '"[0-9]{5}"' THEN 1 END) as with_quoted_plz_in_query
FROM our_google_domains_service;

-- Show some examples of extracted PLZ
SELECT 
    query_company_name,
    query_full,
    query_postal_code,
    'Extracted from query_full' as source
FROM our_google_domains_service 
WHERE query_postal_code IS NOT NULL 
    AND query_full ~ '"[0-9]{5}"'
    AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '1 minute'
LIMIT 10;

-- Also extract unquoted PLZ patterns as backup
UPDATE our_google_domains_service 
SET query_postal_code = (
    -- Extract PLZ from patterns like "Company Street 12345 City"
    SELECT (regexp_match(query_full, '\b([0-9]{5})\b'))[1]
    WHERE query_full ~ '\b[0-9]{5}\b'
)
WHERE query_postal_code IS NULL 
    AND query_full ~ '\b[0-9]{5}\b';

-- Final results
SELECT 
    'Final results' as status,
    COUNT(*) as total_records,
    COUNT(CASE WHEN query_postal_code IS NOT NULL THEN 1 END) as with_plz,
    ROUND(100.0 * COUNT(CASE WHEN query_postal_code IS NOT NULL THEN 1 END) / COUNT(*), 2) as plz_coverage_pct
FROM our_google_domains_service;

-- Show PLZ distribution by region
SELECT 
    substring(query_postal_code from 1 for 2) as plz_region,
    COUNT(*) as companies
FROM our_google_domains_service
WHERE query_postal_code IS NOT NULL
GROUP BY substring(query_postal_code from 1 for 2)
ORDER BY COUNT(*) DESC
LIMIT 10;

COMMIT;