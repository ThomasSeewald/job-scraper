const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

// German keyword mappings with English equivalents for domain email extraction
const KEYWORD_MAPPINGS = {
    'impressum': ['impressum', 'imprint', 'legal-notice', 'legal'],
    'kontakt': ['kontakt', 'contact', 'contact-us', 'kontaktieren'],
    'karriere': ['karriere', 'career', 'careers', 'jobs', 'stellenangebote'],
    'jobs': ['jobs', 'stellenangebote', 'stellen', 'karriere', 'career', 'careers']
};

// Email regex pattern
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

class SimplifiedDetailScraper {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.emailExtractor = new EmailExtractor();
        this.captchaSolver = new IndependentCaptchaSolver();
        this.browser = null;
        this.page = null;
        
        // Configuration
        this.batchSize = 10; // Process 10 jobs at a time
        this.delayBetweenRequests = 2000; // 2 seconds between requests
        this.maxRetries = 2;
    }

    /**
     * Initialize browser and page
     */
    async initializeBrowser() {
        console.log('🚀 Initializing browser...');
        
        this.browser = await puppeteer.launch({
            headless: false, // Set to true for production
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Set user agent to appear more human-like
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('✅ Browser initialized');
    }

    /**
     * Get jobs that need detail scraping (no external URLs, not yet scraped)
     */
    async getJobsToScrape(limit = 50) {
        const query = `
            SELECT 
                j.id,
                j.refnr,
                j.titel,
                j.arbeitgeber,
                j.arbeitsort_ort,
                j.externeurl
            FROM job_scrp_arbeitsagentur_jobs_v2 j
            LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
            WHERE j.is_active = true 
                AND j.refnr IS NOT NULL
                AND (j.externeurl IS NULL OR j.externeurl = '')
                AND jd.reference_number IS NULL
            ORDER BY j.modifikationstimestamp DESC
            LIMIT $1
        `;
        
        const client = await this.pool.connect();
        try {
            const result = await client.query(query, [limit]);
            console.log(`📋 Found ${result.rows.length} jobs ready for detail scraping`);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Construct Arbeitsagentur detail URL from reference number
     */
    constructDetailUrl(refnr) {
        return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
    }

    /**
     * Scrape detail page for a single job
     */
    async scrapeJobDetail(job) {
        const startTime = Date.now();
        let scrapingResult = {
            success: false,
            emails: '',
            bestEmail: '',
            domain: '',
            emailCount: 0,
            captchaSolved: false,
            error: null,
            duration: 0
        };

        try {
            const detailUrl = this.constructDetailUrl(job.refnr);
            console.log(`🔍 Scraping: ${job.titel} - ${job.arbeitgeber}`);
            console.log(`🔗 URL: ${detailUrl}`);

            // Navigate to detail page
            await this.page.goto(detailUrl, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });

            // Check for CAPTCHA
            const captchaDetected = await this.detectAndSolveCaptcha();
            if (captchaDetected) {
                scrapingResult.captchaSolved = true;
                console.log('🔓 CAPTCHA solved, continuing...');
            }

            // Wait a bit for page to fully load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Extract page content
            const html = await this.page.content();
            
            // Extract emails using our focused email extractor
            const emailResult = this.emailExtractor.extractPrioritizedEmails(
                html, 
                job.titel, 
                job.arbeitgeber
            );

            // If no emails found but we have a domain, try keyword-based extraction
            if (emailResult.emailCount === 0 && emailResult.domain) {
                console.log(`🔍 No emails found on detail page, trying keyword extraction from domain: ${emailResult.domain}`);
                const keywordEmails = await this.extractEmailsFromDomain(emailResult.domain);
                if (keywordEmails.emailCount > 0) {
                    console.log(`✅ Found ${keywordEmails.emailCount} emails via keyword extraction: ${keywordEmails.emails}`);
                    emailResult.emails = keywordEmails.emails;
                    emailResult.bestEmail = keywordEmails.bestEmail;
                    emailResult.emailCount = keywordEmails.emailCount;
                    emailResult.keywordExtracted = true;
                }
            }

            scrapingResult = {
                ...scrapingResult,
                success: true,
                emails: emailResult.emails,
                bestEmail: emailResult.bestEmail,
                domain: emailResult.domain,
                emailCount: emailResult.emailCount
            };

            console.log(`✅ Found ${emailResult.emailCount} emails: ${emailResult.emails}`);
            if (emailResult.bestEmail) {
                console.log(`🎯 Best email: ${emailResult.bestEmail}`);
            }

        } catch (error) {
            console.error(`❌ Error scraping ${job.refnr}:`, error.message);
            scrapingResult.error = error.message;
        }

        scrapingResult.duration = Date.now() - startTime;
        return scrapingResult;
    }

    /**
     * Detect and solve CAPTCHA if present
     */
    async detectAndSolveCaptcha() {
        try {
            // Look for CAPTCHA image
            const captchaImage = await this.page.$('img[src*="captcha"], img[alt*="captcha"], img[alt*="Captcha"]');
            
            if (!captchaImage) {
                return false; // No CAPTCHA detected
            }

            console.log('🔒 CAPTCHA detected, solving...');

            // Get image buffer
            const imageBuffer = await captchaImage.screenshot();
            
            // Solve CAPTCHA
            const solution = await this.captchaSolver.solveCaptchaFromBuffer(imageBuffer);
            
            if (solution.success) {
                // Find input field and submit solution
                const inputField = await this.page.$('input[name*="captcha"], input[id*="captcha"]');
                if (inputField) {
                    await inputField.type(solution.text);
                    
                    // Look for submit button
                    const submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
                    if (submitButton) {
                        await submitButton.click();
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page to load
                    }
                }
                
                console.log('✅ CAPTCHA solved successfully');
                return true;
            } else {
                console.log('❌ CAPTCHA solving failed');
                return false;
            }
            
        } catch (error) {
            console.log('❌ CAPTCHA handling error:', error.message);
            return false;
        }
    }

    /**
     * Save scraping results to database
     */
    async saveResults(job, scrapingResult) {
        const insertQuery = `
            INSERT INTO job_scrp_job_details (
                reference_number,
                arbeitsagentur_job_id,
                contact_emails,
                best_email,
                company_domain,
                has_emails,
                email_count,
                scraped_at,
                scraping_duration_ms,
                captcha_solved,
                scraping_success,
                scraping_error,
                source_url,
                scraped_for_keywords
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (reference_number) DO UPDATE SET
                contact_emails = EXCLUDED.contact_emails,
                best_email = EXCLUDED.best_email,
                company_domain = EXCLUDED.company_domain,
                has_emails = EXCLUDED.has_emails,
                email_count = EXCLUDED.email_count,
                scraped_at = CURRENT_TIMESTAMP,
                scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                captcha_solved = EXCLUDED.captcha_solved,
                scraping_success = EXCLUDED.scraping_success,
                scraping_error = EXCLUDED.scraping_error,
                source_url = EXCLUDED.source_url,
                scraped_for_keywords = EXCLUDED.scraped_for_keywords
        `;

        const detailUrl = this.constructDetailUrl(job.refnr);
        const values = [
            job.refnr,
            job.id,
            scrapingResult.emails || null,
            scrapingResult.bestEmail || null,
            scrapingResult.domain || null,
            scrapingResult.emailCount > 0,
            scrapingResult.emailCount,
            scrapingResult.duration,
            scrapingResult.captchaSolved,
            scrapingResult.success,
            scrapingResult.error || null,
            detailUrl,
            scrapingResult.keywordExtracted || false
        ];

        const client = await this.pool.connect();
        try {
            await client.query(insertQuery, values);
            console.log(`💾 Saved results for ${job.refnr}`);
        } catch (error) {
            console.error(`❌ Database save error for ${job.refnr}:`, error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Process a batch of jobs
     */
    async processBatch(jobs) {
        console.log(`\n🔄 Processing batch of ${jobs.length} jobs...`);
        
        let successCount = 0;
        let emailsFoundCount = 0;

        for (const job of jobs) {
            try {
                const result = await this.scrapeJobDetail(job);
                await this.saveResults(job, result);

                if (result.success) {
                    successCount++;
                    if (result.emailCount > 0) {
                        emailsFoundCount++;
                    }
                }

                // Delay between requests
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests));

            } catch (error) {
                console.error(`❌ Failed to process job ${job.refnr}:`, error.message);
            }
        }

        console.log(`\n📊 Batch completed: ${successCount}/${jobs.length} successful, ${emailsFoundCount} with emails`);
        return { successCount, emailsFoundCount, totalJobs: jobs.length };
    }

    /**
     * Main scraping process
     */
    async startScraping(maxJobs = 100) {
        try {
            console.log('🚀 Starting Simplified Detail Scraper');
            console.log('📧 Focus: Extract emails and domains only');
            console.log('🚫 Excluded: Jobs with external URLs, arbeitsagentur emails');

            await this.initializeBrowser();

            const jobs = await this.getJobsToScrape(maxJobs);
            
            if (jobs.length === 0) {
                console.log('✅ No jobs found for detail scraping');
                return;
            }

            // Process jobs in batches
            let totalStats = { successCount: 0, emailsFoundCount: 0, totalJobs: 0 };
            
            for (let i = 0; i < jobs.length; i += this.batchSize) {
                const batch = jobs.slice(i, i + this.batchSize);
                const batchStats = await this.processBatch(batch);
                
                totalStats.successCount += batchStats.successCount;
                totalStats.emailsFoundCount += batchStats.emailsFoundCount;
                totalStats.totalJobs += batchStats.totalJobs;

                // Short break between batches
                if (i + this.batchSize < jobs.length) {
                    console.log('⏸️  Short break between batches...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            console.log('\n🎉 Scraping completed!');
            console.log(`📊 Final Stats:`);
            console.log(`   Total jobs processed: ${totalStats.totalJobs}`);
            console.log(`   Successful scrapes: ${totalStats.successCount}`);
            console.log(`   Jobs with emails found: ${totalStats.emailsFoundCount}`);
            console.log(`   Success rate: ${((totalStats.successCount / totalStats.totalJobs) * 100).toFixed(1)}%`);
            console.log(`   Email discovery rate: ${((totalStats.emailsFoundCount / totalStats.totalJobs) * 100).toFixed(1)}%`);

        } catch (error) {
            console.error('❌ Fatal error:', error.message);
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Extract emails from domain using keyword-based page detection
     */
    async extractEmailsFromDomain(domain) {
        try {
            const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            const allEmails = new Set();
            
            console.log(`🌐 Visiting domain homepage: ${baseUrl}`);
            await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // First check homepage for emails
            let pageText = await this.page.evaluate(() => document.body.textContent || '');
            let foundEmails = pageText.match(EMAIL_PATTERN) || [];
            foundEmails.forEach(email => {
                if (this.isValidBusinessEmail(email)) {
                    allEmails.add(email.toLowerCase());
                }
            });
            
            // Extract keyword-based links from homepage
            const keywordLinks = await this.findKeywordLinks();
            
            // Visit keyword pages and extract emails
            for (const [keyword, links] of Object.entries(keywordLinks)) {
                // Process up to 2 links per keyword to avoid too many requests
                for (const link of links.slice(0, 2)) {
                    try {
                        console.log(`📄 Checking ${keyword} page: ${link.href}`);
                        await this.page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        pageText = await this.page.evaluate(() => document.body.textContent || '');
                        foundEmails = pageText.match(EMAIL_PATTERN) || [];
                        
                        foundEmails.forEach(email => {
                            if (this.isValidBusinessEmail(email)) {
                                allEmails.add(email.toLowerCase());
                            }
                        });
                        
                    } catch (error) {
                        console.log(`❌ Error visiting ${link.href}:`, error.message);
                    }
                }
            }
            
            const emailArray = Array.from(allEmails);
            return {
                emails: emailArray.join(', '),
                bestEmail: emailArray[0] || '',
                emailCount: emailArray.length
            };
            
        } catch (error) {
            console.log(`❌ Error extracting emails from domain ${domain}:`, error.message);
            return {
                emails: '',
                bestEmail: '',
                emailCount: 0
            };
        }
    }

    /**
     * Find keyword-based links on current page
     */
    async findKeywordLinks() {
        try {
            const links = await this.page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                return anchors.map(a => ({
                    href: a.href,
                    text: a.textContent.toLowerCase().trim()
                })).filter(link => link.href && link.href.startsWith('http'));
            });
            
            const keywordLinks = {};
            
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
            
            return keywordLinks;
            
        } catch (error) {
            console.log(`❌ Error finding keyword links:`, error.message);
            return {};
        }
    }

    /**
     * Validate if email is a business email (not test, noreply, etc.)
     */
    isValidBusinessEmail(email) {
        return email && 
               !email.includes('example.') && 
               !email.includes('test@') && 
               !email.includes('noreply@') &&
               !email.includes('no-reply@') &&
               !email.includes('donotreply@') &&
               !email.includes('bounce@') &&
               !email.includes('postmaster@');
    }

    /**
     * Clean up resources
     */
    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 Browser closed');
        }
        await this.pool.end();
        console.log('🧹 Database connections closed');
    }

    /**
     * Get current statistics
     */
    async getStats() {
        const query = `
            SELECT 
                COUNT(*) as total_scraped,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as with_emails,
                COUNT(CASE WHEN best_email IS NOT NULL THEN 1 END) as with_best_email,
                ROUND(AVG(email_count), 2) as avg_emails_per_job,
                COUNT(DISTINCT company_domain) as unique_domains,
                MAX(scraped_at) as last_scrape
            FROM job_scrp_job_details
            WHERE scraping_success = true
        `;

        const client = await this.pool.connect();
        try {
            const result = await client.query(query);
            return result.rows[0];
        } finally {
            client.release();
        }
    }
}

// CLI interface
async function main() {
    const scraper = new SimplifiedDetailScraper();
    
    const args = process.argv.slice(2);
    const maxJobs = args[0] ? parseInt(args[0]) : 50;

    console.log(`Starting detail scraper for up to ${maxJobs} jobs...`);
    
    try {
        await scraper.startScraping(maxJobs);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = SimplifiedDetailScraper;