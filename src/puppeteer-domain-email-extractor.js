const { Pool } = require('pg');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

/**
 * Puppeteer-based Domain Email Extractor
 * 
 * This script processes employer domains (not external portals) using
 * Puppeteer to replicate the Scrapy email extraction functionality.
 * 
 * Strategy (replicated from Scrapy script):
 * 1. Visit homepage and extract emails
 * 2. Look for specific keyword links: impressum, kontakt, karriere, jobs, legal-notice
 * 3. Extract emails from those pages
 * 4. Handle various email obfuscation patterns: @ (at) [at]
 * 5. Organize results by page type
 */

class PuppeteerDomainEmailExtractor {
    constructor() {
        // Database configuration
        this.pool = new Pool({
            user: 'odoo',
            host: 'localhost',
            database: 'jetzt',
            password: 'odoo',
            port: 5473,
        });

        // Keywords to look for in links (from Scrapy script)
        this.keywords = ["impressum", "kontakt", "karriere", "jobs", "home", "legal-notice"];
        
        // Batch size for processing domains
        this.batchSize = 10;
        
        // Delay between domain extractions
        this.delayBetweenDomains = 5000; // 5 seconds

        // Browser configuration
        this.browser = null;
    }

    /**
     * Initialize Puppeteer browser
     */
    async initBrowser() {
        this.browser = await puppeteer.launch({
            headless: process.env.HEADLESS_MODE !== 'false',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
    }

    /**
     * Close browser
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Get unprocessed employer domains from job_scrp_domain_analysis table
     */
    async getUnprocessedEmployerDomains(limit = 10) {
        const query = `
            SELECT domain, base_domain, frequency 
            FROM job_scrp_domain_analysis 
            WHERE classification = 'employer_domain' 
                AND email_extraction_attempted = false
            ORDER BY frequency DESC
            LIMIT $1
        `;
        
        const result = await this.pool.query(query, [limit]);
        return result.rows;
    }

    /**
     * Extract emails from page content using multiple patterns
     */
    extractEmailsFromText(text) {
        const emails = new Set();
        
        // Pattern 1: Standard email format (improved to prevent over-matching)
        const standardEmails = text.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g) || [];
        standardEmails.forEach(email => {
            // Clean up any trailing characters that got included
            const cleanEmail = email.replace(/[^a-zA-Z0-9._%+-@]$/, '');
            if (cleanEmail.includes('@')) {
                emails.add(cleanEmail.toLowerCase());
            }
        });

        // Pattern 2: (at) obfuscation
        const atObfuscated = text.match(/\b[a-zA-Z0-9._%+-]+\(at\)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g) || [];
        atObfuscated.forEach(email => {
            const cleanEmail = email.replace('(at)', '@').replace(/[^a-zA-Z0-9._%+-@]$/, '');
            emails.add(cleanEmail.toLowerCase());
        });

        // Pattern 3: [at] obfuscation
        const bracketAtObfuscated = text.match(/\b[a-zA-Z0-9._%+-]+\[at\][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g) || [];
        bracketAtObfuscated.forEach(email => {
            const cleanEmail = email.replace('[at]', '@').replace(/[^a-zA-Z0-9._%+-@]$/, '');
            emails.add(cleanEmail.toLowerCase());
        });

        // Filter out invalid emails
        return Array.from(emails).filter(email => this.isValidEmail(email));
    }

    /**
     * Basic email validation
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email) && 
               !email.includes('example.') && 
               !email.includes('test@') &&
               !email.includes('noreply') &&
               !email.includes('no-reply') &&
               !email.includes('mailer-daemon');
    }

    /**
     * Find keyword-based links on a page
     */
    async findKeywordLinks(page, baseUrl, allowedDomain) {
        try {
            const links = await page.evaluate(() => {
                const linkElements = document.querySelectorAll('a[href]');
                return Array.from(linkElements).map(link => ({
                    href: link.href,
                    text: link.textContent.toLowerCase()
                }));
            });

            const keywordLinks = {};
            this.keywords.forEach(keyword => {
                keywordLinks[keyword] = [];
            });

            links.forEach(link => {
                const url = new URL(link.href, baseUrl);
                const fullUrl = url.href;
                
                // Check if link is on allowed domain
                if (fullUrl.includes(allowedDomain)) {
                    this.keywords.forEach(keyword => {
                        if (fullUrl.toLowerCase().includes(keyword) || 
                            link.text.includes(keyword)) {
                            keywordLinks[keyword].push(fullUrl);
                        }
                    });
                }
            });

            return keywordLinks;
        } catch (error) {
            console.log(`Error finding keyword links: ${error.message}`);
            return {};
        }
    }

    /**
     * Extract emails from a domain using Puppeteer
     */
    async extractEmailsWithPuppeteer(domain) {
        const page = await this.browser.newPage();
        
        try {
            // Set user agent and headers (replicate Scrapy settings)
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            });

            // Ensure domain has protocol
            const fullDomain = domain.startsWith('http') ? domain : `https://${domain}`;
            const allowedDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');

            const results = {
                emails_by_keyword: {},
                impressum_link: '',
                kontakt_link: '',
                impressum_page_text: '',
                error: null
            };

            // Initialize email collections
            this.keywords.forEach(keyword => {
                results.emails_by_keyword[keyword] = [];
            });

            // Visit homepage
            console.log(`Visiting homepage: ${fullDomain}`);
            
            try {
                const response = await page.goto(fullDomain, { 
                    waitUntil: 'networkidle0', 
                    timeout: 15000 
                });

                if (response.status() === 403) {
                    results.error = "Forbidden for scraper";
                    return results;
                }

                // Check for expired domain
                const pageContent = await page.content();
                if (pageContent.toLowerCase().includes('buy this domain')) {
                    results.error = "Domain expired";
                    return results;
                }

                // Extract emails from homepage
                const homeEmails = this.extractEmailsFromText(pageContent);
                results.emails_by_keyword.home = homeEmails;

                // Find keyword-based links
                const keywordLinks = await this.findKeywordLinks(page, fullDomain, allowedDomain);

                // Visit keyword pages and extract emails
                for (const [keyword, links] of Object.entries(keywordLinks)) {
                    if (links.length > 0) {
                        // Take the first link for each keyword
                        const targetUrl = links[0];
                        
                        try {
                            console.log(`Visiting ${keyword} page: ${targetUrl}`);
                            await page.goto(targetUrl, { 
                                waitUntil: 'networkidle0', 
                                timeout: 15000 
                            });

                            const keywordPageContent = await page.content();
                            const keywordEmails = this.extractEmailsFromText(keywordPageContent);
                            results.emails_by_keyword[keyword] = keywordEmails;

                            // Store special links
                            if (keyword === 'impressum' || keyword === 'legal-notice') {
                                results.impressum_link = targetUrl;
                                results.impressum_page_text = keywordPageContent;
                            } else if (keyword === 'kontakt') {
                                results.kontakt_link = targetUrl;
                            }

                        } catch (keywordError) {
                            console.log(`Error visiting ${keyword} page: ${keywordError.message}`);
                        }
                    }
                }

            } catch (homeError) {
                if (homeError.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
                    results.error = "DNS Lookup Error";
                } else if (homeError.message.includes('timeout')) {
                    results.error = "Timeout Error";
                } else {
                    results.error = homeError.message;
                }
            }

            return results;

        } finally {
            await page.close();
        }
    }

    /**
     * Process extraction results and extract unique emails
     */
    processExtractionResults(results) {
        const allEmails = new Set();
        const metadata = {
            impressum_link: results.impressum_link || '',
            kontakt_link: results.kontakt_link || '',
            error: results.error || null,
            emails_by_section: {}
        };

        // Collect emails from all sections
        for (const [section, emails] of Object.entries(results.emails_by_keyword)) {
            if (Array.isArray(emails) && emails.length > 0) {
                metadata.emails_by_section[section] = emails;
                emails.forEach(email => allEmails.add(email));
            }
        }

        return {
            emails: Array.from(allEmails),
            metadata: metadata
        };
    }

    /**
     * Update job_scrp_domain_analysis table with extraction results
     */
    async updateDomainAnalysis(domain, emails, metadata) {
        const query = `
            UPDATE job_scrp_domain_analysis 
            SET email_extraction_attempted = true,
                emails_found = $2,
                last_extraction_date = CURRENT_TIMESTAMP,
                notes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE domain = $1
        `;
        
        const notes = JSON.stringify({
            extraction_metadata: metadata,
            extraction_method: 'puppeteer_integration'
        });

        await this.pool.query(query, [domain, emails.length, notes]);
    }

    /**
     * Update job_scrp_job_details table with discovered emails
     */
    async updateJobDetailsWithEmails(domain, emails) {
        if (emails.length === 0) return;

        // Find job_scrp_job_details records that use this domain
        const findJobsQuery = `
            SELECT id, contact_emails, has_emails
            FROM job_scrp_job_details 
            WHERE company_domain = $1
        `;
        
        const jobResult = await this.pool.query(findJobsQuery, [domain]);

        if (jobResult.rows.length === 0) {
            console.log(`No job_scrp_job_details found for domain: ${domain}`);
            return;
        }

        // Update each job_detail with the discovered emails
        let updatedJobs = 0;
        for (const job of jobResult.rows) {
            const existingEmails = job.contact_emails ? 
                job.contact_emails.split(',').map(e => e.trim()) : [];
            
            // Merge with existing emails, avoiding duplicates
            const allEmails = [...new Set([...existingEmails, ...emails])];
            
            const updateQuery = `
                UPDATE job_scrp_job_details 
                SET contact_emails = $2,
                    has_emails = true,
                    email_count = $3,
                    best_email = $4
                WHERE id = $1
            `;
            
            const bestEmail = allEmails.find(email => 
                !email.includes('info@') && !email.includes('kontakt@')
            ) || allEmails[0];
            
            await this.pool.query(updateQuery, [
                job.id, 
                allEmails.join(', '), 
                allEmails.length,
                bestEmail
            ]);
            updatedJobs++;
        }
        
        console.log(`Updated ${updatedJobs} job_scrp_job_details records with ${emails.length} emails`);
    }

    /**
     * Update job_scrp_employers table with discovered emails
     */
    async updateEmployersWithEmails(domain, emails) {
        if (emails.length === 0) return;

        // Find job_scrp_employers that use this domain
        const findEmployersQuery = `
            SELECT DISTINCT e.id, e.name, e.contact_emails
            FROM job_scrp_employers e
            WHERE e.website LIKE $1 
               OR e.company_domain LIKE $1
        `;
        
        const domainPattern = `%${domain}%`;
        const employerResult = await this.pool.query(findEmployersQuery, [domainPattern]);

        if (employerResult.rows.length === 0) {
            console.log(`No job_scrp_employers found for domain: ${domain}`);
            return;
        }

        // Update each employer with the discovered emails
        for (const employer of employerResult.rows) {
            const existingEmails = employer.contact_emails ? 
                employer.contact_emails.split(',').map(e => e.trim()) : [];
            
            // Merge with existing emails, avoiding duplicates
            const allEmails = [...new Set([...existingEmails, ...emails])];
            
            const updateQuery = `
                UPDATE job_scrp_employers 
                SET contact_emails = $2,
                    email_extraction_date = CURRENT_TIMESTAMP,
                    email_extraction_attempted = true
                WHERE id = $1
            `;
            
            await this.pool.query(updateQuery, [employer.id, allEmails.join(', ')]);
            console.log(`Updated employer ${employer.name} with ${emails.length} new emails`);
        }
    }

    /**
     * Process a single domain for email extraction
     */
    async processDomain(domainInfo) {
        const { domain, base_domain, frequency } = domainInfo;
        
        console.log(`Processing domain: ${domain} (frequency: ${frequency})`);
        
        try {
            // Use Puppeteer to extract emails
            const extractionResults = await this.extractEmailsWithPuppeteer(domain);
            
            // Process results
            const { emails, metadata } = this.processExtractionResults(extractionResults);
            
            console.log(`Found ${emails.length} emails on ${domain}`);
            if (emails.length > 0) {
                console.log(`Emails: ${emails.join(', ')}`);
            }
            
            if (metadata.error) {
                console.log(`Extraction error for ${domain}: ${metadata.error}`);
            }

            // Update database
            await this.updateDomainAnalysis(domain, emails, metadata);
            await this.updateJobDetailsWithEmails(domain, emails);
            await this.updateEmployersWithEmails(domain, emails);
            
            return {
                domain,
                success: true,
                emailsFound: emails.length,
                emails,
                error: metadata.error
            };

        } catch (error) {
            console.error(`Error processing domain ${domain}:`, error.message);
            
            // Still mark as attempted even if failed
            await this.updateDomainAnalysis(domain, [], { error: error.message });
            
            return {
                domain,
                success: false,
                emailsFound: 0,
                emails: [],
                error: error.message
            };
        }
    }

    /**
     * Main execution method
     */
    async run(maxDomains = 10) {
        console.log('Starting Puppeteer-based domain email extraction...');
        
        try {
            // Initialize browser
            await this.initBrowser();

            // Get unprocessed employer domains
            const domains = await this.getUnprocessedEmployerDomains(maxDomains);
            
            if (domains.length === 0) {
                console.log('No unprocessed employer domains found.');
                return;
            }

            console.log(`Found ${domains.length} unprocessed employer domains`);

            const results = [];
            
            // Process domains one by one with delays
            for (let i = 0; i < domains.length; i++) {
                const domain = domains[i];
                
                console.log(`\n--- Processing ${i + 1}/${domains.length}: ${domain.domain} ---`);
                
                const result = await this.processDomain(domain);
                results.push(result);
                
                // Add delay between domains (except for the last one)
                if (i < domains.length - 1) {
                    console.log(`Waiting ${this.delayBetweenDomains / 1000} seconds before next domain...`);
                    await new Promise(resolve => setTimeout(resolve, this.delayBetweenDomains));
                }
            }

            // Summary
            const successful = results.filter(r => r.success && !r.error).length;
            const totalEmails = results.reduce((sum, r) => sum + r.emailsFound, 0);
            
            console.log(`\n--- Summary ---`);
            console.log(`Domains processed: ${results.length}`);
            console.log(`Successful extractions: ${successful}`);
            console.log(`Total emails found: ${totalEmails}`);
            console.log(`Average emails per domain: ${(totalEmails / results.length).toFixed(1)}`);

            return results;

        } catch (error) {
            console.error('Error in main execution:', error);
            throw error;
        } finally {
            await this.closeBrowser();
            await this.pool.end();
        }
    }
}

// CLI execution
if (require.main === module) {
    const maxDomains = parseInt(process.argv[2]) || 5;
    
    const extractor = new PuppeteerDomainEmailExtractor();
    extractor.run(maxDomains)
        .then(results => {
            console.log('\nPuppeteer domain email extraction completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Puppeteer domain email extraction failed:', error);
            process.exit(1);
        });
}

module.exports = PuppeteerDomainEmailExtractor;