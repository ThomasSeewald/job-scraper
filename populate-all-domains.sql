-- Populate domain_analysis with ALL domains from job_details (both with and without emails)

-- Clear existing data first
TRUNCATE TABLE domain_analysis;

-- Insert ALL domains from job_details
INSERT INTO domain_analysis (domain, base_domain, frequency, classification, emails_found, email_extraction_attempted)
SELECT 
    company_domain,
    -- Extract base domain (handle NULL case and ensure NOT NULL)
    CASE 
        WHEN company_domain IS NULL THEN 'unknown'
        WHEN company_domain ~ '^[^.]+\.[^.]+$' THEN company_domain  -- Already base domain
        WHEN company_domain ~ '\.' THEN 
            COALESCE(SUBSTRING(company_domain FROM '([^.]+\.[^.]+)$'), company_domain)  -- Extract last two parts
        ELSE company_domain  -- Fallback to original
    END as base_domain,
    COUNT(*) as frequency,
    -- Enhanced classification
    CASE 
        -- External job portals and platforms
        WHEN company_domain LIKE '%softgarden%' THEN 'external_portal'
        WHEN company_domain LIKE '%contactrh%' THEN 'external_portal'
        WHEN company_domain LIKE '%easyapply%' THEN 'external_portal'
        WHEN company_domain LIKE '%arbeitsagentur%' THEN 'external_portal'
        WHEN company_domain LIKE '%bewerbung%' THEN 'external_portal'
        WHEN company_domain LIKE '%stepstone%' THEN 'external_portal'
        WHEN company_domain LIKE '%indeed%' THEN 'external_portal'
        WHEN company_domain LIKE '%xing%' THEN 'external_portal'
        WHEN company_domain LIKE '%linkedin%' THEN 'external_portal'
        WHEN company_domain LIKE '%guidecom%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobware%' THEN 'external_portal'
        WHEN company_domain LIKE '%stellenanzeigen%' THEN 'external_portal'
        WHEN company_domain LIKE '%monster.%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobscout%' THEN 'external_portal'
        WHEN company_domain LIKE '%recruitee%' THEN 'external_portal'
        WHEN company_domain LIKE '%personio%' THEN 'external_portal'
        WHEN company_domain LIKE '%smartrecruiters%' THEN 'external_portal'
        WHEN company_domain LIKE '%workday%' THEN 'external_portal'
        WHEN company_domain LIKE '%successfactors%' THEN 'external_portal'
        WHEN company_domain LIKE '%icims.com%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobexport%' THEN 'external_portal'
        WHEN company_domain LIKE '%tinyurl%' THEN 'external_portal'
        
        -- Likely employer domains
        WHEN company_domain LIKE '%karriere.%' THEN 'employer_domain'
        WHEN company_domain LIKE '%career%' THEN 'employer_domain'
        WHEN company_domain ~ '\.(de|com|org|net|at|ch|eu)$' THEN 'employer_domain'
        
        -- Unknown/ambiguous
        ELSE 'unknown'
    END as classification,
    -- Mark if emails were found
    CASE 
        WHEN MAX(CASE WHEN has_emails = true THEN 1 ELSE 0 END) = 1 THEN 1
        ELSE 0
    END as emails_found,
    -- Mark if extraction was attempted
    CASE 
        WHEN MAX(CASE WHEN has_emails = true THEN 1 ELSE 0 END) = 1 THEN true
        ELSE false
    END as email_extraction_attempted
FROM job_details 
WHERE company_domain IS NOT NULL 
    AND company_domain != ''
    AND company_domain NOT LIKE '%http%'  -- Exclude malformed domains
    AND LENGTH(company_domain) <= 250  -- Only domains that fit in VARCHAR(255)
    AND company_domain NOT LIKE '%\\n%'  -- Exclude domains with newlines (likely text content)
    AND company_domain NOT LIKE 'PHN2%'  -- Exclude SVG data
    AND company_domain ~ '^[a-zA-Z0-9.-]+$'  -- Only allow valid domain characters
GROUP BY company_domain;

-- Show comprehensive results
SELECT 'COMPLETE DOMAIN ANALYSIS' as status;
SELECT 
    classification,
    COUNT(*) as domain_count,
    SUM(frequency) as total_job_occurrences,
    COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails,
    ROUND(AVG(frequency), 1) as avg_jobs_per_domain
FROM domain_analysis 
GROUP BY classification
ORDER BY domain_count DESC;

-- Show statistics
SELECT 'SUMMARY STATISTICS' as status;
SELECT 
    COUNT(*) as total_domains_analyzed,
    SUM(frequency) as total_job_occurrences,
    COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails,
    COUNT(CASE WHEN classification = 'external_portal' THEN 1 END) as external_portals,
    COUNT(CASE WHEN classification = 'employer_domain' THEN 1 END) as employer_domains,
    COUNT(CASE WHEN classification = 'unknown' THEN 1 END) as unknown_domains
FROM domain_analysis;