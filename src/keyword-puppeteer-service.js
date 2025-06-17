const puppeteer = require('puppeteer');
const EmailExtractor = require('./email-extractor');

class KeywordPuppeteerService {
    constructor() {
        this.browser = null;
        this.emailExtractor = new EmailExtractor();
        this.isInitialized = false;
        
        // Keyword mappings: English -> German column names
        this.keywordMappings = {
            // German keywords
            'impressum': 'impressum_emails',
            'imprint': 'impressum_emails',
            'legal-notice': 'impressum_emails',
            'legal': 'impressum_emails',
            
            'kontakt': 'kontakt_emails',
            'contact': 'kontakt_emails',
            'contacts': 'kontakt_emails',
            
            'karriere': 'karriere_emails',
            'career': 'karriere_emails',
            'careers': 'karriere_emails',
            'stellenangebote': 'karriere_emails',
            
            'jobs': 'jobs_emails',
            'job': 'jobs_emails',
            'stellen': 'jobs_emails',
            'stellenanzeigen': 'jobs_emails'
        };
        
        console.log('🔍 Keyword Puppeteer Service initialized');
    }

    /**
     * Initialize the browser for keyword scraping
     */
    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        try {
            console.log('🌐 Starting keyword scraping browser (headless)...');
            
            this.browser = await puppeteer.launch({
                headless: true, // Always headless for keyword scraping
                defaultViewport: null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1366,768'
                ]
            });

            this.isInitialized = true;
            console.log('✅ Keyword scraping browser ready');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize keyword browser:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * Scrape a domain for keyword-specific emails
     */
    async scrapeKeywordEmails(domain) {
        const startTime = Date.now();
        const results = {
            impressum_emails: [],
            kontakt_emails: [],
            karriere_emails: [],
            jobs_emails: [],
            success: false,
            error: null,
            processed_urls: []
        };

        try {
            if (!this.isInitialized) {
                const initialized = await this.initialize();
                if (!initialized) {
                    throw new Error('Failed to initialize browser');
                }
            }

            // Ensure domain has protocol
            const domainUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            console.log(`🔍 Scraping keywords for: ${domainUrl}`);

            const page = await this.browser.newPage();
            
            // Set user agent and viewport
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1366, height: 768 });

            // Navigate to homepage with timeout
            await page.goto(domainUrl, { 
                waitUntil: 'networkidle2',
                timeout: 15000 
            });

            // Check for domain issues
            const pageContent = await page.content();
            if (pageContent.toLowerCase().includes('buy this domain') || 
                pageContent.toLowerCase().includes('domain expired')) {
                throw new Error('Domain expired or for sale');
            }

            // Find all links on the homepage
            const links = await page.evaluate(() => {
                const linkElements = document.querySelectorAll('a[href]');
                return Array.from(linkElements).map(link => ({
                    href: link.href,
                    text: link.textContent.trim().toLowerCase()
                }));
            });

            // Filter links by keywords and categorize them
            const keywordLinks = this.categorizeLinks(links, domainUrl);
            console.log(`📋 Found ${Object.keys(keywordLinks).length} keyword categories with links`);

            // Scrape emails from each keyword category
            for (const [category, categoryLinks] of Object.entries(keywordLinks)) {
                if (categoryLinks.length === 0) continue;

                console.log(`📄 Processing ${category} links (${categoryLinks.length} found)`);
                
                for (const link of categoryLinks.slice(0, 3)) { // Limit to 3 links per category
                    try {
                        await page.goto(link, { 
                            waitUntil: 'networkidle2',
                            timeout: 10000 
                        });

                        const html = await page.content();
                        const emailResult = this.emailExtractor.extractPrioritizedEmails(html, '', '');
                        
                        if (emailResult.emails) {
                            const emails = emailResult.emails.split(',').map(e => e.trim()).filter(e => e);
                            results[category] = results[category].concat(emails);
                            console.log(`📧 Found ${emails.length} emails on ${category} page: ${emails.join(', ')}`);
                        }

                        results.processed_urls.push(link);
                        
                        // Small delay between requests
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                    } catch (linkError) {
                        console.log(`⚠️ Failed to process ${category} link ${link}: ${linkError.message}`);
                    }
                }
            }

            // Remove duplicates from each category
            for (const category of Object.keys(results)) {
                if (Array.isArray(results[category])) {
                    results[category] = [...new Set(results[category])];
                }
            }

            await page.close();
            
            const duration = Date.now() - startTime;
            const totalEmails = results.impressum_emails.length + results.kontakt_emails.length + 
                              results.karriere_emails.length + results.jobs_emails.length;
            
            results.success = true;
            console.log(`✅ Keyword scraping completed for ${domain} in ${duration}ms - found ${totalEmails} total emails`);
            
            return results;

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Keyword scraping error for ${domain}:`, error.message);
            
            results.success = false;
            results.error = error.message;
            results.duration = duration;
            
            return results;
        }
    }

    /**
     * Categorize links based on keywords
     */
    categorizeLinks(links, baseDomain) {
        const categories = {
            impressum_emails: [],
            kontakt_emails: [],
            karriere_emails: [],
            jobs_emails: []
        };

        for (const link of links) {
            // Only process links from the same domain
            if (!link.href.includes(baseDomain.replace('https://', '').replace('http://', ''))) {
                continue;
            }

            const linkText = link.text.toLowerCase();
            const linkHref = link.href.toLowerCase();

            // Check both link text and URL for keywords
            const searchText = `${linkText} ${linkHref}`;

            for (const [keyword, category] of Object.entries(this.keywordMappings)) {
                if (searchText.includes(keyword)) {
                    if (!categories[category].includes(link.href)) {
                        categories[category].push(link.href);
                    }
                }
            }
        }

        return categories;
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        console.log('🧹 Cleaning up keyword scraping browser...');
        
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                console.log('⚠️ Error closing browser:', error.message);
            }
            this.browser = null;
        }
        
        this.isInitialized = false;
        console.log('✅ Keyword scraping cleanup completed');
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.isInitialized || !this.browser) {
                return { healthy: false, error: 'Not initialized' };
            }

            // Test if browser is still responsive
            const pages = await this.browser.pages();
            
            return {
                healthy: true,
                openPages: pages.length,
                isInitialized: this.isInitialized
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

module.exports = KeywordPuppeteerService;