-- Add 'old' column to arbeitsagentur_jobs_v2 table
-- This will mark all existing records as 'old' to differentiate from new imports

-- Step 1: Add the column with default value false
ALTER TABLE arbeitsagentur_jobs_v2 
ADD COLUMN old BOOLEAN DEFAULT false;

-- Step 2: Set all existing records to old = true
UPDATE arbeitsagentur_jobs_v2 
SET old = true;

-- Step 3: Create index for better performance on old/new filtering
CREATE INDEX IF NOT EXISTS idx_arbeitsagentur_jobs_v2_old ON arbeitsagentur_jobs_v2(old);

-- Step 4: Show summary of the changes
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN old = true THEN 1 END) as old_records,
    COUNT(CASE WHEN old = false THEN 1 END) as new_records
FROM arbeitsagentur_jobs_v2;