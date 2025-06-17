-- Add keyword-specific email columns to job_details table
-- This enables storing emails found on specific types of pages

ALTER TABLE job_details 
ADD COLUMN IF NOT EXISTS impressum_emails TEXT,
ADD COLUMN IF NOT EXISTS kontakt_emails TEXT,
ADD COLUMN IF NOT EXISTS karriere_emails TEXT,
ADD COLUMN IF NOT EXISTS jobs_emails TEXT,
ADD COLUMN IF NOT EXISTS scraped_for_keywords BOOLEAN DEFAULT FALSE;

-- Add index for efficient querying of domains to be keyword-scraped
CREATE INDEX IF NOT EXISTS idx_job_details_keyword_scraping 
ON job_details (scraped_for_keywords, has_emails, company_domain);

-- Show the new structure
SELECT 'KEYWORD SCRAPING COLUMNS ADDED' as status;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'job_details' 
  AND table_schema = 'public'
  AND column_name IN ('impressum_emails', 'kontakt_emails', 'karriere_emails', 'jobs_emails', 'scraped_for_keywords')
ORDER BY column_name;