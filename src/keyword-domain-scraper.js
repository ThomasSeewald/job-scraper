const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

// German keyword mappings with English equivalents
const KEYWORD_MAPPINGS = {
    'impressum': ['impressum', 'imprint', 'legal-notice', 'legal'],
    'kontakt': ['kontakt', 'contact', 'contact-us', 'kontaktieren'],
    'karriere': ['karriere', 'career', 'careers', 'jobs', 'stellenangebote'],
    'jobs': ['jobs', 'stellenangebote', 'stellen', 'karriere', 'career', 'careers']
};

// Email regex pattern
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

class KeywordDomainScraper {
    constructor(options = {}) {
        this.headless = options.headless !== false;
        this.timeout = options.timeout || 30000;
        this.maxDomains = options.maxDomains || 25; // Process 25 domains per run
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('Initializing keyword domain scraper...');
        this.browser = await puppeteer.launch({
            headless: this.headless,
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
        this.page = await this.browser.newPage();
        
        // Set user agent to appear as regular browser
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Set reasonable timeouts
        await this.page.setDefaultTimeout(this.timeout);
        await this.page.setDefaultNavigationTimeout(this.timeout);
        
        console.log('Keyword domain scraper initialized successfully');
    }

    async getDomainsToScrape() {
        // First try employers with websites but no emails
        const employerQuery = `
            SELECT 
                e.id,
                e.name as employer_name,
                e.website as domain,
                e.website as base_domain,
                1 as frequency,
                'Employers' as source_table
            FROM job_scrp_employers e
            WHERE e.website IS NOT NULL 
            AND e.website != ''
            AND (e.contact_emails IS NULL OR e.contact_emails = '')
            ORDER BY e.job_count DESC
            LIMIT $1
        `;
        
        let result = await pool.query(employerQuery, [this.maxDomains]);
        
        if (result.rows.length > 0) {
            console.log(`Found ${result.rows.length} employers with websites but no emails to scrape`);
            return result.rows;
        }
        
        // Fallback to domain_analysis table if no employers need processing
        const domainQuery = `
            SELECT 
                da.id,
                da.domain,
                da.base_domain,
                da.frequency,
                'Domain Analysis' as source_table
            FROM job_scrp_domain_analysis da
            WHERE (da.email_extraction_attempted IS NULL OR da.email_extraction_attempted = false)
            AND da.domain IS NOT NULL 
            AND da.domain != ''
            ORDER BY da.frequency DESC, da.id
            LIMIT $1
        `;
        
        result = await pool.query(domainQuery, [this.maxDomains]);
        console.log(`Found ${result.rows.length} domains to scrape for keywords (from job_scrp_domain_analysis table)`);
        return result.rows;
    }

    async findKeywordLinks(domain) {
        const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
        const keywordLinks = {};
        
        try {
            console.log(`Visiting domain: ${baseUrl}`);
            await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await new Promise(resolve => setTimeout(resolve, 2000)); // Brief wait for content to load
            
            // Extract all links from the page
            const links = await this.page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                return anchors.map(a => ({
                    href: a.href,
                    text: a.textContent.toLowerCase().trim()
                })).filter(link => link.href && link.href.startsWith('http'));
            });
            
            // Categorize links by keywords
            for (const [germanKeyword, variants] of Object.entries(KEYWORD_MAPPINGS)) {
                const matchingLinks = links.filter(link => {
                    const url = link.href.toLowerCase();
                    const text = link.text.toLowerCase();
                    
                    return variants.some(keyword => 
                        url.includes(keyword) || text.includes(keyword)
                    );
                });
                
                if (matchingLinks.length > 0) {
                    keywordLinks[germanKeyword] = matchingLinks;
                }
            }
            
            console.log(`Found keyword links for ${domain}:`, Object.keys(keywordLinks));
            return keywordLinks;
            
        } catch (error) {
            console.log(`Error visiting ${baseUrl}:`, error.message);
            return {};
        }
    }

    async scrapeEmailsFromKeywordPages(keywordLinks, domain) {
        const emailsByKeyword = {};
        
        for (const [keyword, links] of Object.entries(keywordLinks)) {
            const emails = new Set();
            
            // Process up to 3 links per keyword to avoid too many requests
            for (const link of links.slice(0, 3)) {
                try {
                    console.log(`Scraping ${keyword} page: ${link.href}`);
                    await this.page.goto(link.href, { waitUntil: 'domcontentloaded' });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Extract text content and find emails
                    const pageText = await this.page.evaluate(() => document.body.textContent || '');
                    const foundEmails = pageText.match(EMAIL_PATTERN) || [];
                    
                    foundEmails.forEach(email => {
                        // Filter out common non-useful emails
                        if (!email.includes('example.') && 
                            !email.includes('test@') && 
                            !email.includes('noreply@') &&
                            !email.includes('no-reply@')) {
                            emails.add(email.toLowerCase());
                        }
                    });
                    
                } catch (error) {
                    console.log(`Error scraping ${link.href}:`, error.message);
                }
            }
            
            if (emails.size > 0) {
                emailsByKeyword[keyword] = Array.from(emails).join(', ');
                console.log(`Found ${emails.size} emails for ${keyword} on ${domain}`);
            }
        }
        
        return emailsByKeyword;
    }

    async updateDomainAnalysis(domainId, emailsByKeyword) {
        // Combine all emails found and count them
        const allEmails = [];
        for (const emails of Object.values(emailsByKeyword)) {
            if (emails) {
                allEmails.push(...emails.split(', '));
            }
        }
        
        const uniqueEmails = [...new Set(allEmails)];
        const emailCount = uniqueEmails.length;
        
        const updateQuery = `
            UPDATE job_scrp_domain_analysis 
            SET 
                email_extraction_attempted = $1,
                emails_found = $2,
                last_extraction_date = $3,
                notes = $4,
                updated_at = $5
            WHERE id = $6
        `;
        
        // Create detailed notes with email addresses and keyword sources
        let notes = '';
        if (Object.keys(emailsByKeyword).length > 0) {
            const keywordSummary = Object.keys(emailsByKeyword).join(', ');
            const emailList = uniqueEmails.slice(0, 10).join(', '); // First 10 emails
            const truncated = uniqueEmails.length > 10 ? ` (and ${uniqueEmails.length - 10} more)` : '';
            notes = `Keyword scraping found ${emailCount} emails in: ${keywordSummary}. Emails: ${emailList}${truncated}`;
        } else {
            notes = 'Keyword scraping attempted - no emails found';
        }
        
        await pool.query(updateQuery, [
            true,                    // email_extraction_attempted
            emailCount,              // emails_found (integer count)
            new Date(),             // last_extraction_date
            notes,                  // notes (includes actual emails)
            new Date(),             // updated_at
            domainId                // WHERE id
        ]);
        
        console.log(`Updated job_scrp_domain_analysis: ${emailCount} emails found`);
    }

    async updateEmployer(employerId, emailsByKeyword) {
        // Combine all emails from different keyword pages
        const allEmails = [];
        for (const [keyword, emails] of Object.entries(emailsByKeyword)) {
            if (emails) {
                allEmails.push(...emails.split(', '));
            }
        }
        
        const uniqueEmails = [...new Set(allEmails)];
        const emailCount = uniqueEmails.length;
        
        const updateQuery = `
            UPDATE job_scrp_employers 
            SET 
                contact_emails = $1,
                notes = CASE 
                    WHEN notes IS NULL THEN $2
                    ELSE notes || E'\\n' || $2
                END,
                last_updated = $3
            WHERE id = $4
        `;
        
        // Create detailed notes with email addresses and keyword sources
        let notes = '';
        if (Object.keys(emailsByKeyword).length > 0) {
            const keywordSummary = Object.keys(emailsByKeyword).join(', ');
            notes = `Keyword scraping (${new Date().toISOString().split('T')[0]}): Found ${emailCount} emails in: ${keywordSummary}`;
        } else {
            notes = `Keyword scraping (${new Date().toISOString().split('T')[0]}): No emails found`;
        }
        
        await pool.query(updateQuery, [
            uniqueEmails.join(', '),  // contact_emails
            notes,                    // notes to append
            new Date(),              // last_updated
            employerId               // WHERE id
        ]);
        
        console.log(`Updated employer: ${emailCount} emails found`);
    }

    async processDomain(domainInfo) {
        const { id, domain, frequency, source_table, employer_name } = domainInfo;
        
        try {
            console.log(`\nProcessing domain: ${domain} (source: ${source_table})`);
            if (employer_name) {
                console.log(`  Employer: ${employer_name}`);
            }
            
            // Find keyword-based links on the domain
            const keywordLinks = await this.findKeywordLinks(domain);
            
            // Scrape emails from keyword pages
            const emailsByKeyword = await this.scrapeEmailsFromKeywordPages(keywordLinks, domain);
            
            // Update the appropriate table based on source
            if (source_table === 'Employers') {
                await this.updateEmployer(id, emailsByKeyword);
            } else {
                await this.updateDomainAnalysis(id, emailsByKeyword);
            }
            
            const totalEmails = Object.values(emailsByKeyword).reduce((total, emails) => 
                total + (emails ? emails.split(', ').length : 0), 0);
                
            console.log(`Completed ${domain}: ${totalEmails} emails found`);
            
            return {
                domain: domain,
                emailsFound: totalEmails,
                success: true
            };
            
        } catch (error) {
            console.error(`Error processing ${domain}:`, error);
            
            // Mark as attempted even on error to avoid infinite retries
            if (source_table === 'Employers') {
                await this.updateEmployer(id, {});
            } else {
                await this.updateDomainAnalysis(id, {});
            }
            
            return {
                domain: domain,
                emailsFound: 0,
                success: false,
                error: error.message
            };
        }
    }

    async run() {
        try {
            console.log('Starting keyword domain scraping run...');
            await this.init();
            
            const domains = await this.getDomainsToScrape();
            if (domains.length === 0) {
                console.log('No domains found to scrape. All domains have been processed.');
                return;
            }
            
            const results = [];
            for (const domain of domains) {
                const result = await this.processDomain(domain);
                results.push(result);
                
                // Small delay between domains to be respectful
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Summary
            const successful = results.filter(r => r.success).length;
            const totalEmails = results.reduce((sum, r) => sum + r.emailsFound, 0);
            
            console.log(`\n=== Keyword Scraping Summary ===`);
            console.log(`Domains processed: ${results.length}`);
            console.log(`Successful: ${successful}`);
            console.log(`Total emails found: ${totalEmails}`);
            console.log(`Average emails per domain: ${(totalEmails / results.length).toFixed(2)}`);
            
        } catch (error) {
            console.error('Error in keyword domain scraper:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
            await pool.end();
        }
    }
}

// CLI usage
if (require.main === module) {
    const maxDomains = process.argv[2] ? parseInt(process.argv[2]) : 50;
    const headless = process.env.HEADLESS_MODE !== 'false';
    
    const scraper = new KeywordDomainScraper({ 
        maxDomains, 
        headless 
    });
    
    scraper.run().catch(console.error);
}

module.exports = KeywordDomainScraper;