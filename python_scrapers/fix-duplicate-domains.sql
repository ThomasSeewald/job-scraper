-- Fix duplicate domains before integration
-- This handles case sensitivity and normalization issues

BEGIN;

-- 1. Show existing duplicates when normalized
WITH normalized_duplicates AS (
    SELECT 
        LOWER(TRIM(domain)) as normalized_domain,
        COUNT(*) as count,
        array_agg(id ORDER BY create_date DESC) as ids,
        array_agg(domain ORDER BY create_date DESC) as original_domains
    FROM our_domains
    WHERE domain IS NOT NULL
    GROUP BY LOWER(TRIM(domain))
    HAVING COUNT(*) > 1
)
SELECT 
    'Duplicate domains found' as status,
    COUNT(*) as duplicate_groups,
    SUM(count - 1) as extra_records_to_remove
FROM normalized_duplicates;

-- 2. Keep only the best record for each normalized domain
-- Best = has emails > has impressum link > oldest
DELETE FROM our_domains
WHERE id IN (
    SELECT unnest(ids[2:]) -- Keep first, delete rest
    FROM (
        SELECT array_agg(
            id ORDER BY 
            emails_found DESC NULLS LAST,
            CASE WHEN impressum_link IS NOT NULL THEN 1 ELSE 0 END DESC,
            create_date ASC
        ) as ids
        FROM our_domains
        WHERE domain IS NOT NULL
        GROUP BY LOWER(TRIM(domain))
        HAVING COUNT(*) > 1
    ) dup
);

-- 3. Show result
SELECT 
    'After cleanup' as status,
    COUNT(*) as total_domains,
    COUNT(DISTINCT LOWER(TRIM(domain))) as unique_normalized_domains
FROM our_domains
WHERE domain IS NOT NULL;

COMMIT;