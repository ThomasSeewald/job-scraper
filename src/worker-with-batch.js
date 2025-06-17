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

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

class WorkerWithBatch {
    constructor(workerId, domainBatch, options = {}) {
        this.workerId = workerId;
        this.domainBatch = domainBatch; // Pre-allocated domains for this worker only
        this.headless = options.headless !== false;
        this.timeout = options.timeout || 30000;
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log(`[Worker ${this.workerId}] Initializing with ${this.domainBatch.length} domains...`);
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
            ],
            protocolTimeout: 60000 // Increase from default 30s to 60s
        });
        this.page = await this.browser.newPage();
        
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setDefaultTimeout(this.timeout);
        await this.page.setDefaultNavigationTimeout(this.timeout);
        
        console.log(`[Worker ${this.workerId}] Ready to process domains`);
    }

    async acceptCookies() {
        try {
            console.log(`[Worker ${this.workerId}] Checking for cookie modal...`);
            
            // Check if the cookie button exists
            const cookieButton = await this.page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            
            if (cookieButton) {
                console.log(`[Worker ${this.workerId}] Cookie modal found, accepting cookies...`);
                
                // Click the cookie accept button
                await this.page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                
                // Wait for modal to disappear
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                console.log(`[Worker ${this.workerId}] Cookies accepted successfully`);
                return true;
            } else {
                console.log(`[Worker ${this.workerId}] No cookie modal found`);
                return false;
            }
        } catch (error) {
            console.log(`[Worker ${this.workerId}] Cookie handling error: ${error.message}`);
            return false;
        }
    }

    async findKeywordLinks(domain) {
        const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
        const keywordLinks = {};
        
        try {
            console.log(`[Worker ${this.workerId}] Visiting: ${baseUrl}`);
            await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            
            // Wait a bit for any modals to appear
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Handle cookie acceptance
            await this.acceptCookies();
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const links = await this.page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                return anchors.map(a => ({
                    href: a.href,
                    text: a.textContent.toLowerCase().trim()
                })).filter(link => link.href && link.href.startsWith('http'));
            });
            
            for (const [germanKeyword, variants] of Object.entries(KEYWORD_MAPPINGS)) {
                const matchingLinks = links.filter(link => {
                    const url = link.href.toLowerCase();
                    const text = link.text.toLowerCase();
                    return variants.some(keyword => url.includes(keyword) || text.includes(keyword));
                });
                
                if (matchingLinks.length > 0) {
                    keywordLinks[germanKeyword] = matchingLinks;
                }
            }
            
            return keywordLinks;
            
        } catch (error) {
            console.log(`[Worker ${this.workerId}] Error visiting ${baseUrl}: ${error.message}`);
            return {};
        }
    }

    async scrapeEmailsFromKeywordPages(keywordLinks, domain) {
        const emailsByKeyword = {};
        
        for (const [keyword, links] of Object.entries(keywordLinks)) {
            const emails = new Set();
            
            for (const link of links.slice(0, 3)) {
                try {
                    await this.page.goto(link.href, { waitUntil: 'domcontentloaded' });
                    
                    // Check for cookies on subpages too
                    await this.acceptCookies();
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const pageText = await this.page.evaluate(() => document.body.textContent || '');
                    const foundEmails = pageText.match(EMAIL_PATTERN) || [];
                    
                    foundEmails.forEach(email => {
                        if (!email.includes('example.') && 
                            !email.includes('test@') && 
                            !email.includes('noreply@') &&
                            !email.includes('no-reply@')) {
                            emails.add(email.toLowerCase());
                        }
                    });
                    
                } catch (error) {
                    // Skip failed pages
                }
            }
            
            if (emails.size > 0) {
                emailsByKeyword[keyword] = Array.from(emails).join(', ');
            }
        }
        
        return emailsByKeyword;
    }

    async updateDomainAnalysis(domainId, emailsByKeyword) {
        const allEmails = [];
        for (const emails of Object.values(emailsByKeyword)) {
            if (emails) {
                allEmails.push(...emails.split(', '));
            }
        }
        
        const uniqueEmails = [...new Set(allEmails)];
        const emailCount = uniqueEmails.length;
        
        let notes = '';
        if (Object.keys(emailsByKeyword).length > 0) {
            const keywordSummary = Object.keys(emailsByKeyword).join(', ');
            const emailList = uniqueEmails.slice(0, 5).join(', ');
            const truncated = uniqueEmails.length > 5 ? ` (and ${uniqueEmails.length - 5} more)` : '';
            notes = `Worker ${this.workerId}: ${emailCount} emails in ${keywordSummary}. ${emailList}${truncated}`;
        } else {
            notes = `Worker ${this.workerId}: No emails found`;
        }
        
        await pool.query(`
            UPDATE job_scrp_domain_analysis 
            SET 
                email_extraction_attempted = true,
                emails_found = $1,
                last_extraction_date = NOW(),
                notes = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [emailCount, notes, domainId]);
        
        return emailCount;
    }

    async processDomain(domainInfo) {
        const { id, domain, frequency } = domainInfo;
        
        try {
            const keywordLinks = await this.findKeywordLinks(domain);
            const emailsByKeyword = await this.scrapeEmailsFromKeywordPages(keywordLinks, domain);
            const emailCount = await this.updateDomainAnalysis(id, emailsByKeyword);
            
            console.log(`[Worker ${this.workerId}] ✓ ${domain}: ${emailCount} emails`);
            return { domain, emailCount, success: true };
            
        } catch (error) {
            console.log(`[Worker ${this.workerId}] ✗ ${domain}: ${error.message}`);
            await this.updateDomainAnalysis(id, {});
            return { domain, emailCount: 0, success: false };
        }
    }

    async run() {
        try {
            await this.init();
            
            const results = [];
            console.log(`[Worker ${this.workerId}] Processing ${this.domainBatch.length} domains...`);
            
            for (const domain of this.domainBatch) {
                const result = await this.processDomain(domain);
                results.push(result);
                
                // Small delay between domains
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Recreate browser every 50 domains to prevent memory/protocol issues
                if (results.length % 50 === 0) {
                    console.log(`[Worker ${this.workerId}] Restarting browser after ${results.length} domains...`);
                    await this.browser.close();
                    await this.init();
                }
            }
            
            const successful = results.filter(r => r.success).length;
            const totalEmails = results.reduce((sum, r) => sum + r.emailCount, 0);
            
            console.log(`[Worker ${this.workerId}] DONE: ${results.length} domains, ${successful} successful, ${totalEmails} emails`);
            
            return {
                workerId: this.workerId,
                domainsProcessed: results.length,
                successful,
                totalEmails,
                results
            };
            
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

module.exports = WorkerWithBatch;