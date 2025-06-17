-- Create schema for Google Domains Service
-- This is a centralized service for all projects (job scraper, yellow pages, etc.)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy matching
CREATE EXTENSION IF NOT EXISTS unaccent; -- For handling German umlauts

-- Main table for Google search results and domain verification
CREATE TABLE IF NOT EXISTS our_google_domains_service (
    id SERIAL PRIMARY KEY,
    
    -- Query information (what was searched)
    query_company_name VARCHAR(500) NOT NULL,
    query_street VARCHAR(255),
    query_postal_code VARCHAR(10),
    query_city VARCHAR(255),
    query_full TEXT NOT NULL,
    query_source VARCHAR(50), -- 'job_scraper', 'yellow_pages', 'manual', etc.
    
    -- Normalized company name for fuzzy matching
    company_name_normalized VARCHAR(500),
    
    -- Google result information
    result_title VARCHAR(500),
    result_url TEXT,
    result_snippet TEXT,
    result_domain VARCHAR(255),
    result_position INTEGER, -- Position in Google results (1-10)
    
    -- Verification status
    is_verified BOOLEAN DEFAULT false,
    verification_date TIMESTAMP,
    verification_method VARCHAR(50), -- 'address_match', 'manual', 'auto'
    
    -- Address verification details
    impressum_url TEXT,
    impressum_addresses JSONB, -- Array of addresses found on impressum
    address_match_score FLOAT, -- 0-1 score for address matching
    address_match_details JSONB, -- Detailed matching info from libpostal
    
    -- Extracted emails by page type
    impressum_emails TEXT[],
    kontakt_emails TEXT[],
    karriere_emails TEXT[],
    jobs_emails TEXT[],
    all_emails TEXT[], -- Combined unique emails
    email_extraction_date TIMESTAMP,
    
    -- Domain metadata
    domain_type VARCHAR(50), -- 'employer', 'directory', 'portal', 'unknown'
    domain_confidence FLOAT, -- 0-1 confidence score
    
    -- API response storage
    google_api_response JSONB,
    google_search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50), -- Which system created this
    
    -- Prevent duplicates for same company/domain combination
    CONSTRAINT unique_company_domain UNIQUE(query_company_name, result_domain)
);

-- Indexes for performance
CREATE INDEX idx_gds_company_trgm ON google_domains_service 
    USING gin(query_company_name gin_trgm_ops);
CREATE INDEX idx_gds_normalized_trgm ON google_domains_service 
    USING gin(company_name_normalized gin_trgm_ops);
CREATE INDEX idx_gds_postal_code ON google_domains_service(query_postal_code);
CREATE INDEX idx_gds_domain ON google_domains_service(result_domain);
CREATE INDEX idx_gds_verified ON google_domains_service(is_verified, domain_confidence DESC);
CREATE INDEX idx_gds_source ON google_domains_service(query_source);

-- Function to normalize company names
CREATE OR REPLACE FUNCTION normalize_company_name(name TEXT) 
RETURNS TEXT AS $$
BEGIN
    -- Convert to lowercase and trim
    name := LOWER(TRIM(name));
    
    -- Remove common punctuation
    name := REGEXP_REPLACE(name, '[.,\-_/]', ' ', 'g');
    
    -- Standardize company forms
    name := REGEXP_REPLACE(name, '\bg\.?m\.?b\.?h\.?\b', 'gmbh', 'gi');
    name := REGEXP_REPLACE(name, '\bgesellschaft mit beschränkter haftung\b', 'gmbh', 'gi');
    name := REGEXP_REPLACE(name, '\ba\.?g\.?\b', 'ag', 'gi');
    name := REGEXP_REPLACE(name, '\baktiengesellschaft\b', 'ag', 'gi');
    name := REGEXP_REPLACE(name, '\bk\.?g\.?\b', 'kg', 'gi');
    name := REGEXP_REPLACE(name, '\bkommanditgesellschaft\b', 'kg', 'gi');
    name := REGEXP_REPLACE(name, '\bo\.?h\.?g\.?\b', 'ohg', 'gi');
    name := REGEXP_REPLACE(name, '\bg\.?b\.?r\.?\b', 'gbr', 'gi');
    name := REGEXP_REPLACE(name, '\bu\.?g\.?\b', 'ug', 'gi');
    name := REGEXP_REPLACE(name, '\b&\s*co\.?\b', 'co', 'gi');
    name := REGEXP_REPLACE(name, '\bund\b', '&', 'gi');
    
    -- Remove extra spaces
    name := REGEXP_REPLACE(name, '\s+', ' ', 'g');
    
    -- Apply unaccent to handle umlauts
    name := unaccent(name);
    
    RETURN TRIM(name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-update normalized name
CREATE OR REPLACE FUNCTION update_normalized_name()
RETURNS TRIGGER AS $$
BEGIN
    NEW.company_name_normalized := normalize_company_name(NEW.query_company_name);
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_normalized_name
BEFORE INSERT OR UPDATE ON google_domains_service
FOR EACH ROW
EXECUTE FUNCTION update_normalized_name();

-- View for easy access to verified domains
CREATE OR REPLACE VIEW verified_employer_domains AS
SELECT 
    query_company_name,
    query_postal_code,
    result_domain,
    all_emails,
    domain_confidence,
    address_match_score,
    verification_date
FROM google_domains_service
WHERE is_verified = true
    AND domain_type = 'employer'
    AND domain_confidence >= 0.7
ORDER BY domain_confidence DESC;

-- Function to find similar companies
CREATE OR REPLACE FUNCTION find_similar_companies(
    company_name TEXT,
    postal_code TEXT DEFAULT NULL,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id INTEGER,
    original_company TEXT,
    domain TEXT,
    emails TEXT[],
    similarity_score FLOAT,
    is_verified BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        gds.id,
        gds.query_company_name,
        gds.result_domain,
        gds.all_emails,
        similarity(gds.company_name_normalized, normalize_company_name(company_name)) as sim_score,
        gds.is_verified
    FROM google_domains_service gds
    WHERE 
        (postal_code IS NULL OR gds.query_postal_code = postal_code)
        AND similarity(gds.company_name_normalized, normalize_company_name(company_name)) >= similarity_threshold
        AND gds.is_verified = true
    ORDER BY sim_score DESC, gds.domain_confidence DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- Usage tracking table
CREATE TABLE IF NOT EXISTS google_domains_usage (
    id SERIAL PRIMARY KEY,
    source_system VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'search', 'verify', 'extract_emails'
    company_name VARCHAR(500),
    domain VARCHAR(255),
    success BOOLEAN,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_source ON google_domains_usage(source_system, created_at DESC);

-- API keys and configuration
CREATE TABLE IF NOT EXISTS google_domains_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO google_domains_config (key, value, description) VALUES
    ('google_api_key', 'AIzaSyBUv0IUn7f4OEfzPF8mqcdHf3X8ubcI7MU', 'Google Custom Search API Key'),
    ('google_search_engine_id', '24f407b14f2344198', 'Google Custom Search Engine ID'),
    ('2captcha_api_key', '', 'For solving CAPTCHAs when scraping impressum pages'),
    ('max_results_per_search', '10', 'Maximum Google results to process'),
    ('verification_threshold', '0.75', 'Minimum score for address verification')
ON CONFLICT (key) DO NOTHING;