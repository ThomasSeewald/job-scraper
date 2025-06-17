-- Migration script to add offer_type to arbeitsagentur_jobs_v2 table
-- This script should be run after the email migration is complete

-- Step 1: Add offer_type column if it doesn't exist
ALTER TABLE arbeitsagentur_jobs_v2 ADD COLUMN IF NOT EXISTS offer_type VARCHAR(10);

-- Step 2: Update existing records with offer_type from our_sql_employment_agency
UPDATE arbeitsagentur_jobs_v2 
SET offer_type = old.offer_type
FROM our_sql_employment_agency old
WHERE arbeitsagentur_jobs_v2.refnr = old.reference_number
AND old.offer_type IS NOT NULL
AND arbeitsagentur_jobs_v2.offer_type IS NULL;

-- Step 3: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_offer_type ON arbeitsagentur_jobs_v2(offer_type);

-- Step 4: Verify the migration results
SELECT 
  'Migration Results' as description,
  offer_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM arbeitsagentur_jobs_v2 
WHERE is_active = true AND offer_type IS NOT NULL
GROUP BY offer_type
ORDER BY offer_type;

-- Step 5: Cross-check with text-based detection
SELECT 
  'Cross-check Results' as description,
  CASE 
    WHEN offer_type = '1' THEN 'Jobs (offer_type=1)'
    WHEN offer_type = '4' THEN 'Ausbildung (offer_type=4)'
    ELSE 'Unknown/NULL offer_type'
  END as category,
  COUNT(*) as total,
  COUNT(CASE WHEN LOWER(titel) LIKE '%ausbildung%' OR LOWER(beruf) LIKE '%ausbildung%' THEN 1 END) as with_ausbildung_text,
  ROUND(COUNT(CASE WHEN LOWER(titel) LIKE '%ausbildung%' OR LOWER(beruf) LIKE '%ausbildung%' THEN 1 END) * 100.0 / COUNT(*), 2) as ausbildung_percentage
FROM arbeitsagentur_jobs_v2 
WHERE is_active = true
GROUP BY offer_type
ORDER BY offer_type;

-- Step 6: Show mapping statistics
SELECT 
  'Mapping Statistics' as description,
  COUNT(*) as total_active_jobs,
  COUNT(CASE WHEN offer_type IS NOT NULL THEN 1 END) as jobs_with_offer_type,
  ROUND(COUNT(CASE WHEN offer_type IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as mapping_percentage,
  COUNT(CASE WHEN offer_type = '1' THEN 1 END) as regular_jobs,
  COUNT(CASE WHEN offer_type = '4' THEN 1 END) as ausbildung_jobs
FROM arbeitsagentur_jobs_v2 
WHERE is_active = true;