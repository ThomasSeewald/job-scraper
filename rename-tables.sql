-- Rename job scraper tables with job_scrp_ prefix
-- Run this with: PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f rename-tables.sql

BEGIN;

-- Rename main tables
ALTER TABLE arbeitsagentur_jobs_v2 RENAME TO job_scrp_arbeitsagentur_jobs_v2;
ALTER TABLE job_details RENAME TO job_scrp_job_details;
ALTER TABLE employers RENAME TO job_scrp_employers;
ALTER TABLE domain_analysis RENAME TO job_scrp_domain_analysis;

-- Note: our_sql_postal_code is shared with other systems, so keeping original name

COMMIT;

-- Verify the renames
\dt job_scrp_*