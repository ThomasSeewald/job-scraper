-- Create domain analysis table
CREATE TABLE IF NOT EXISTS domain_analysis (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) UNIQUE NOT NULL,
    base_domain VARCHAR(255) NOT NULL,
    frequency INTEGER DEFAULT 1,
    classification VARCHAR(50), -- 'external_portal', 'employer_domain', 'unknown'
    email_extraction_attempted BOOLEAN DEFAULT false,
    emails_found INTEGER DEFAULT 0,
    last_extraction_date TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_domain_analysis_classification ON domain_analysis(classification);
CREATE INDEX IF NOT EXISTS idx_domain_analysis_base_domain ON domain_analysis(base_domain);

-- Insert initial data from existing job_details
INSERT INTO domain_analysis (domain, base_domain, frequency, classification)
SELECT 
    company_domain,
    -- Extract base domain (e.g., 'example.com' from 'subdomain.example.com')
    CASE 
        WHEN company_domain ~ '^[^.]+\.[^.]+$' THEN company_domain  -- Already base domain
        ELSE SUBSTRING(company_domain FROM '([^.]+\.[^.]+)$')       -- Extract last two parts
    END as base_domain,
    COUNT(*) as frequency,
    -- Initial classification based on known patterns
    CASE 
        WHEN company_domain LIKE '%softgarden%' THEN 'external_portal'
        WHEN company_domain LIKE '%contactrh%' THEN 'external_portal'
        WHEN company_domain LIKE '%easyapply%' THEN 'external_portal'
        WHEN company_domain LIKE '%arbeitsagentur%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobs.%' THEN 'external_portal'
        WHEN company_domain LIKE '%bewerbung%' THEN 'external_portal'
        WHEN company_domain LIKE '%karriere.%' THEN 'employer_domain'
        WHEN company_domain ~ '\.(de|com|org|net|at|ch)$' THEN 'employer_domain'
        ELSE 'unknown'
    END as classification
FROM job_details 
WHERE company_domain IS NOT NULL 
    AND company_domain != ''
    AND has_emails = false
GROUP BY company_domain
ON CONFLICT (domain) DO UPDATE SET
    frequency = EXCLUDED.frequency,
    updated_at = CURRENT_TIMESTAMP;

-- Add known external portal patterns
INSERT INTO domain_analysis (domain, base_domain, classification, notes) VALUES
('softgarden.de', 'softgarden.de', 'external_portal', 'Job portal platform'),
('contactrh.com', 'contactrh.com', 'external_portal', 'HR platform'),
('easyapply.jobs', 'easyapply.jobs', 'external_portal', 'Job application platform'),
('guidecom.de', 'guidecom.de', 'external_portal', 'Job platform'),
('xing.com', 'xing.com', 'external_portal', 'Professional network'),
('linkedin.com', 'linkedin.com', 'external_portal', 'Professional network'),
('stepstone.de', 'stepstone.de', 'external_portal', 'Job portal'),
('indeed.com', 'indeed.com', 'external_portal', 'Job portal')
ON CONFLICT (domain) DO UPDATE SET
    classification = EXCLUDED.classification,
    notes = EXCLUDED.notes,
    updated_at = CURRENT_TIMESTAMP;

-- Show summary
SELECT 
    classification,
    COUNT(*) as domain_count,
    SUM(frequency) as total_occurrences
FROM domain_analysis 
GROUP BY classification
ORDER BY total_occurrences DESC;