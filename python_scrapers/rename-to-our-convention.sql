-- Rename table to follow our_ naming convention
-- This script renames google_domains_service to our_google_domains_service

BEGIN;

-- First check if table exists
SELECT COUNT(*) as records FROM google_domains_service;

-- Rename the main table
ALTER TABLE google_domains_service RENAME TO our_google_domains_service;

-- Update all indexes to follow naming convention
ALTER INDEX idx_gds_company_trgm RENAME TO idx_our_gds_company_trgm;
ALTER INDEX idx_gds_normalized_trgm RENAME TO idx_our_gds_normalized_trgm;
ALTER INDEX idx_gds_postal_code RENAME TO idx_our_gds_postal_code;
ALTER INDEX idx_gds_domain RENAME TO idx_our_gds_domain;
ALTER INDEX idx_gds_verified RENAME TO idx_our_gds_verified;
ALTER INDEX idx_gds_source RENAME TO idx_our_gds_source;

-- Update sequence name
ALTER SEQUENCE google_domains_service_id_seq RENAME TO our_google_domains_service_id_seq;

-- Update constraint names
ALTER TABLE our_google_domains_service 
RENAME CONSTRAINT unique_company_domain TO our_unique_company_domain;

-- Update the trigger function to reference new table name
DROP TRIGGER IF EXISTS trigger_update_normalized_name ON our_google_domains_service;

CREATE TRIGGER trigger_update_normalized_name
BEFORE INSERT OR UPDATE ON our_google_domains_service
FOR EACH ROW
EXECUTE FUNCTION update_normalized_name();

-- Rename other related tables to follow convention
ALTER TABLE google_domains_usage RENAME TO our_google_domains_usage;
ALTER TABLE google_domains_config RENAME TO our_google_domains_config;
ALTER TABLE google_domains_migration_log RENAME TO our_google_domains_migration_log;

-- Update index for usage table
ALTER INDEX idx_usage_source RENAME TO idx_our_usage_source;

COMMIT;

-- Verify the rename
SELECT 'our_google_domains_service' as new_table_name, COUNT(*) as records 
FROM our_google_domains_service;