-- Add offer_type column to arbeitsagentur_jobs_v2 table
-- Step 1: Add the new column
ALTER TABLE arbeitsagentur_jobs_v2 ADD COLUMN IF NOT EXISTS offer_type VARCHAR(10);

-- Step 2: Create index for performance
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_offer_type ON arbeitsagentur_jobs_v2(offer_type);

-- Step 3: Update existing records with offer_type from our_sql_employment_agency
UPDATE arbeitsagentur_jobs_v2 
SET offer_type = old.offer_type
FROM our_sql_employment_agency old
WHERE arbeitsagentur_jobs_v2.refnr = old.reference_number
AND old.offer_type IS NOT NULL;

-- Step 4: Verify the migration
SELECT 
  offer_type,
  COUNT(*) as count,
  COUNT(CASE WHEN LOWER(titel) LIKE '%ausbildung%' OR LOWER(beruf) LIKE '%ausbildung%' THEN 1 END) as ausbildung_matches
FROM arbeitsagentur_jobs_v2 
WHERE is_active = true AND offer_type IS NOT NULL
GROUP BY offer_type
ORDER BY offer_type;

-- Step 5: Check overall statistics
SELECT 
  COUNT(*) as total_active_jobs,
  COUNT(CASE WHEN offer_type IS NOT NULL THEN 1 END) as jobs_with_offer_type,
  COUNT(CASE WHEN offer_type = '1' THEN 1 END) as regular_jobs,
  COUNT(CASE WHEN offer_type = '4' THEN 1 END) as ausbildung_jobs
FROM arbeitsagentur_jobs_v2 
WHERE is_active = true;