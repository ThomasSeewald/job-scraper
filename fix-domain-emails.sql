-- Fix domain_analysis emails_found to match actual job_details data
UPDATE domain_analysis 
SET emails_found = CASE 
    WHEN domain IN (
        SELECT DISTINCT company_domain 
        FROM job_details 
        WHERE contact_emails IS NOT NULL 
        AND contact_emails != ''
        AND company_domain IS NOT NULL 
        AND company_domain != ''
    ) THEN 1 
    ELSE 0 
END,
email_extraction_attempted = CASE 
    WHEN domain IN (
        SELECT DISTINCT company_domain 
        FROM job_details 
        WHERE contact_emails IS NOT NULL 
        AND contact_emails != ''
        AND company_domain IS NOT NULL 
        AND company_domain != ''
    ) THEN true 
    ELSE false 
END;

SELECT 'CORRECTED DOMAIN ANALYSIS' as status;
SELECT 
    classification,
    COUNT(*) as total_domains,
    COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails
FROM domain_analysis 
GROUP BY classification
ORDER BY total_domains DESC;