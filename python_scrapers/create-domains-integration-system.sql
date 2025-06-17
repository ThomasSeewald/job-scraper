-- Create integration system between job scraper and our_domains
-- This creates tables and functions for matching employers with existing domain data

BEGIN;

-- 1. Create employer-domain mapping table
CREATE TABLE IF NOT EXISTS our_employer_domain_matches (
    id SERIAL PRIMARY KEY,
    
    -- Job scraper reference
    job_reference_number VARCHAR(50),
    employer_name TEXT,
    
    -- our_domains reference
    domain_id INTEGER REFERENCES our_domains(id),
    domain_name TEXT,
    domain_url VARCHAR(255),
    
    -- Match information
    match_type VARCHAR(50), -- 'exact_domain', 'fuzzy_name', 'address_match', 'manual'
    match_confidence FLOAT, -- 0-1 confidence score
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'verified', 'rejected', 'processing'
    
    -- Results
    emails_found BOOLEAN DEFAULT false,
    extracted_emails TEXT,
    retry_attempted BOOLEAN DEFAULT false,
    retry_success BOOLEAN,
    retry_error TEXT,
    
    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_by VARCHAR(50) DEFAULT 'integration_system'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_employer_domain_job_ref ON our_employer_domain_matches(job_reference_number);
CREATE INDEX IF NOT EXISTS idx_employer_domain_domain_id ON our_employer_domain_matches(domain_id);
CREATE INDEX IF NOT EXISTS idx_employer_domain_match_type ON our_employer_domain_matches(match_type);
CREATE INDEX IF NOT EXISTS idx_employer_domain_status ON our_employer_domain_matches(status);

-- 2. Create retry queue table for failed our_domains records
CREATE TABLE IF NOT EXISTS our_domains_retry_queue (
    id SERIAL PRIMARY KEY,
    
    -- Reference to our_domains
    domain_id INTEGER REFERENCES our_domains(id),
    domain_url VARCHAR(255),
    original_error TEXT,
    
    -- Retry classification
    retry_category VARCHAR(50), -- 'dns_retry', 'playwright_retry', 'link_detection_retry', etc.
    priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest
    
    -- Retry tracking
    retry_attempts INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_retry_at TIMESTAMP,
    next_retry_at TIMESTAMP,
    
    -- Results
    retry_success BOOLEAN,
    new_emails TEXT,
    new_error TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'queued', -- 'queued', 'processing', 'completed', 'failed', 'skipped'
    
    -- Tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON our_domains_retry_queue(status, priority, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_retry_queue_category ON our_domains_retry_queue(retry_category);

-- 3. Populate exact domain matches
INSERT INTO our_employer_domain_matches (
    job_reference_number,
    employer_name,
    domain_id,
    domain_name,
    domain_url,
    match_type,
    match_confidence,
    status,
    emails_found,
    extracted_emails
)
SELECT 
    jd.reference_number,
    j.arbeitgeber,
    d.id,
    d.the_name,
    d.domain,
    'exact_domain',
    1.0,
    CASE WHEN d.emails_found = true THEN 'verified' ELSE 'pending' END,
    COALESCE(d.emails_found, false),
    d.best_email
FROM job_scrp_arbeitsagentur_jobs_v2 j
JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
JOIN our_domains d ON LOWER(TRIM(jd.company_domain)) = LOWER(TRIM(d.domain))
WHERE jd.company_domain IS NOT NULL 
    AND jd.company_domain != ''
    AND d.domain IS NOT NULL 
    AND d.domain != ''
    AND j.is_active = true
ON CONFLICT DO NOTHING;

SELECT 'Exact domain matches created' as result, COUNT(*) as count FROM our_employer_domain_matches WHERE match_type = 'exact_domain';

-- 4. Populate retry queue with categorized failures
INSERT INTO our_domains_retry_queue (
    domain_id,
    domain_url,
    original_error,
    retry_category,
    priority,
    next_retry_at
)
SELECT 
    d.id,
    d.domain,
    d.error_message,
    CASE 
        WHEN d.error_message LIKE '%DNS Lookup Error%' THEN 'dns_retry'
        WHEN d.error_message LIKE '%Forbidden for scrapy%' THEN 'playwright_retry'
        WHEN d.error_message LIKE '%Timeout Error%' THEN 'timeout_retry'
        WHEN d.error_message LIKE '%kontakt_link%' THEN 'link_detection_retry'
        WHEN d.error_message LIKE '%Expecting value%' THEN 'json_parsing_retry'
        WHEN d.error_message LIKE '%Domain expired%' THEN 'domain_expired'
        ELSE 'other_retry'
    END,
    CASE 
        WHEN d.error_message LIKE '%DNS Lookup Error%' THEN 3  -- High priority
        WHEN d.error_message LIKE '%Forbidden for scrapy%' THEN 2  -- Very high priority
        WHEN d.error_message LIKE '%kontakt_link%' THEN 4  -- Medium priority
        WHEN d.error_message LIKE '%Timeout Error%' THEN 5  -- Normal priority
        WHEN d.error_message LIKE '%Domain expired%' THEN 9  -- Low priority
        ELSE 7  -- Lower priority
    END,
    CURRENT_TIMESTAMP + INTERVAL '1 hour'  -- Start retrying in 1 hour
FROM our_domains d
WHERE d.error_message IS NOT NULL 
    AND d.error_message != ''
    AND d.emails_found != true
    AND d.domain IS NOT NULL
    AND d.domain != ''
    AND d.error_message NOT LIKE '%Domain expired%'  -- Skip expired domains for now
ON CONFLICT DO NOTHING;

SELECT 'Retry queue populated' as result, COUNT(*) as count FROM our_domains_retry_queue;

-- 5. Create function to find fuzzy name matches
CREATE OR REPLACE FUNCTION find_fuzzy_employer_matches(
    employer_name TEXT,
    similarity_threshold FLOAT DEFAULT 0.8
)
RETURNS TABLE (
    domain_id INTEGER,
    domain_name TEXT,
    domain_url TEXT,
    similarity_score FLOAT,
    has_address BOOLEAN,
    has_emails BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.the_name,
        d.domain,
        similarity(
            LOWER(REGEXP_REPLACE(employer_name, '\s+(gmbh|ag|kg|ohg|gbr|ug|co|e\.?k\.?)(\s|$)', '', 'gi')),
            LOWER(REGEXP_REPLACE(d.the_name, '\s+(gmbh|ag|kg|ohg|gbr|ug|co|e\.?k\.?)(\s|$)', '', 'gi'))
        ) as sim_score,
        (d.street_number IS NOT NULL AND d.zip IS NOT NULL) as has_addr,
        COALESCE(d.emails_found, false) as has_emails
    FROM our_domains d
    WHERE d.the_name IS NOT NULL 
        AND LENGTH(d.the_name) > 3
        AND similarity(
            LOWER(REGEXP_REPLACE(employer_name, '\s+(gmbh|ag|kg|ohg|gbr|ug|co|e\.?k\.?)(\s|$)', '', 'gi')),
            LOWER(REGEXP_REPLACE(d.the_name, '\s+(gmbh|ag|kg|ohg|gbr|ug|co|e\.?k\.?)(\s|$)', '', 'gi'))
        ) >= similarity_threshold
    ORDER BY sim_score DESC, has_emails DESC, has_addr DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- 6. Create views for easy monitoring
CREATE OR REPLACE VIEW employer_domain_integration_stats AS
SELECT 
    'Total Active Jobs' as metric,
    COUNT(*)::TEXT as value
FROM job_scrp_arbeitsagentur_jobs_v2 
WHERE is_active = true

UNION ALL

SELECT 
    'Jobs with Scraped Details' as metric,
    COUNT(*)::TEXT as value
FROM job_scrp_arbeitsagentur_jobs_v2 j
JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
WHERE j.is_active = true

UNION ALL

SELECT 
    'Domain Matches Found' as metric,
    COUNT(*)::TEXT as value
FROM our_employer_domain_matches

UNION ALL

SELECT 
    'Verified Matches (with emails)' as metric,
    COUNT(*)::TEXT as value
FROM our_employer_domain_matches
WHERE status = 'verified' AND emails_found = true

UNION ALL

SELECT 
    'Retry Queue Size' as metric,
    COUNT(*)::TEXT as value
FROM our_domains_retry_queue
WHERE status = 'queued'

UNION ALL

SELECT 
    'High Priority Retries' as metric,
    COUNT(*)::TEXT as value
FROM our_domains_retry_queue
WHERE status = 'queued' AND priority <= 3;

-- 7. Create function to get next retry batch
CREATE OR REPLACE FUNCTION get_next_retry_batch(batch_size INTEGER DEFAULT 50)
RETURNS TABLE (
    queue_id INTEGER,
    domain_id INTEGER,
    domain_url TEXT,
    retry_category TEXT,
    original_error TEXT,
    retry_attempts INTEGER
) AS $$
BEGIN
    RETURN QUERY
    UPDATE our_domains_retry_queue 
    SET status = 'processing',
        last_retry_at = CURRENT_TIMESTAMP,
        retry_attempts = retry_attempts + 1
    WHERE id IN (
        SELECT q.id 
        FROM our_domains_retry_queue q
        WHERE q.status = 'queued' 
            AND q.retry_attempts < q.max_retries
            AND (q.next_retry_at IS NULL OR q.next_retry_at <= CURRENT_TIMESTAMP)
        ORDER BY q.priority ASC, q.created_at ASC
        LIMIT batch_size
    )
    RETURNING 
        id,
        our_domains_retry_queue.domain_id,
        domain_url,
        retry_category,
        original_error,
        retry_attempts;
END;
$$ LANGUAGE plpgsql;

-- 8. Show integration summary
SELECT 'INTEGRATION SYSTEM CREATED' as status;

SELECT * FROM employer_domain_integration_stats;

-- Show retry categories
SELECT 
    retry_category,
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
    AVG(priority) as avg_priority
FROM our_domains_retry_queue 
GROUP BY retry_category 
ORDER BY avg_priority ASC;

COMMIT;

-- Usage examples:
-- SELECT * FROM find_fuzzy_employer_matches('Mercedes-Benz Group AG');
-- SELECT * FROM get_next_retry_batch(25);
-- SELECT * FROM employer_domain_integration_stats;