-- Populate domain_analysis table with ALL domains from job_details
-- This fixes the issue where only 27 domains were analyzed out of 30,593 total

-- First, let's see current state
SELECT 'BEFORE POPULATION' as status;
SELECT classification, COUNT(*) as count FROM domain_analysis GROUP BY classification;

-- Insert all missing domains from job_details (domains without emails)
INSERT INTO domain_analysis (domain, base_domain, frequency, classification)
SELECT 
    company_domain,
    -- Extract base domain (e.g., 'example.com' from 'subdomain.example.com')
    CASE 
        WHEN company_domain ~ '^[^.]+\.[^.]+$' THEN company_domain  -- Already base domain
        ELSE SUBSTRING(company_domain FROM '([^.]+\.[^.]+)$')       -- Extract last two parts
    END as base_domain,
    COUNT(*) as frequency,
    -- Enhanced classification with more patterns
    CASE 
        -- External job portals and platforms
        WHEN company_domain LIKE '%softgarden%' THEN 'external_portal'
        WHEN company_domain LIKE '%contactrh%' THEN 'external_portal'
        WHEN company_domain LIKE '%easyapply%' THEN 'external_portal'
        WHEN company_domain LIKE '%arbeitsagentur%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobs.%' THEN 'external_portal'
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
        
        -- Likely employer domains (career pages)
        WHEN company_domain LIKE '%karriere.%' THEN 'employer_domain'
        WHEN company_domain LIKE '%career%' THEN 'employer_domain'
        WHEN company_domain LIKE '%jobs.%' AND company_domain NOT LIKE '%stepstone%' AND company_domain NOT LIKE '%indeed%' THEN 'employer_domain'
        
        -- Standard employer domains (common TLDs)
        WHEN company_domain ~ '\.(de|com|org|net|at|ch|eu)$' THEN 'employer_domain'
        
        -- Unknown/ambiguous
        ELSE 'unknown'
    END as classification
FROM job_details 
WHERE company_domain IS NOT NULL 
    AND company_domain != ''
    AND has_emails = false  -- Focus on domains where we haven't found emails yet
GROUP BY company_domain
ON CONFLICT (domain) DO UPDATE SET
    frequency = EXCLUDED.frequency,
    classification = CASE 
        WHEN domain_analysis.classification = 'unknown' THEN EXCLUDED.classification
        ELSE domain_analysis.classification  -- Keep existing classification if not unknown
    END,
    updated_at = CURRENT_TIMESTAMP;

-- Also add domains WITH emails for completeness
INSERT INTO domain_analysis (domain, base_domain, frequency, classification)
SELECT 
    company_domain,
    CASE 
        WHEN company_domain ~ '^[^.]+\.[^.]+$' THEN company_domain
        ELSE SUBSTRING(company_domain FROM '([^.]+\.[^.]+)$')
    END as base_domain,
    COUNT(*) as frequency,
    CASE 
        WHEN company_domain LIKE '%softgarden%' THEN 'external_portal'
        WHEN company_domain LIKE '%contactrh%' THEN 'external_portal'
        WHEN company_domain LIKE '%easyapply%' THEN 'external_portal'
        WHEN company_domain LIKE '%arbeitsagentur%' THEN 'external_portal'
        WHEN company_domain LIKE '%jobs.%' THEN 'external_portal'
        WHEN company_domain LIKE '%bewerbung%' THEN 'external_portal'
        WHEN company_domain LIKE '%stepstone%' THEN 'external_portal'
        WHEN company_domain LIKE '%indeed%' THEN 'external_portal'
        WHEN company_domain LIKE '%xing%' THEN 'external_portal'
        WHEN company_domain LIKE '%linkedin%' THEN 'external_portal'
        WHEN company_domain LIKE '%guidecom%' THEN 'external_portal'
        WHEN company_domain LIKE '%karriere.%' THEN 'employer_domain'
        WHEN company_domain ~ '\.(de|com|org|net|at|ch|eu)$' THEN 'employer_domain'
        ELSE 'unknown'
    END as classification
FROM job_details 
WHERE company_domain IS NOT NULL 
    AND company_domain != ''
    AND has_emails = true  -- Domains that already have emails
GROUP BY company_domain
ON CONFLICT (domain) DO UPDATE SET
    frequency = domain_analysis.frequency + EXCLUDED.frequency,  -- Add to existing frequency
    emails_found = CASE 
        WHEN domain_analysis.emails_found = 0 THEN 1  -- Mark as having emails
        ELSE domain_analysis.emails_found
    END,
    updated_at = CURRENT_TIMESTAMP;

-- Show results after population
SELECT 'AFTER POPULATION' as status;
SELECT 
    classification,
    COUNT(*) as domain_count,
    SUM(frequency) as total_job_occurrences,
    COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails
FROM domain_analysis 
GROUP BY classification
ORDER BY domain_count DESC;

-- Show top domains by frequency
SELECT 'TOP DOMAINS BY FREQUENCY' as status;
SELECT domain, classification, frequency, emails_found
FROM domain_analysis 
ORDER BY frequency DESC 
LIMIT 20;