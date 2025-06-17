const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

class TargetedDetailScraper {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.emailExtractor = new EmailExtractor();
        this.captchaSolver = new IndependentCaptchaSolver();
        this.browser = null;
        this.page = null;
        
        // Configuration for targeted scraping
        this.delayBetweenRequests = 3000; // 3 seconds between requests
        this.maxRetries = 2;
        
        // CAPTCHA frequency monitoring
        this.captchaCount = 0;
        this.pagesProcessed = 0;
        this.lastCaptchaPage = 0;
        this.minPagesBeforeCaptcha = 15; // Error if CAPTCHA appears sooner
    }

    /**
     * Initialize browser and page
     */
    async initializeBrowser(headlessMode = true) {
        console.log(`🎯 Initializing targeted browser (headless: ${headlessMode})...`);
        
        this.browser = await puppeteer.launch({
            headless: headlessMode,
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
        
        console.log('✅ Targeted browser initialized');
    }

    /**
     * Construct Arbeitsagentur detail URL from reference number
     */
    constructDetailUrl(refnr) {
        return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
    }

    /**
     * Scrape detailed information from a job listing
     */
    async scrapeJobDetail(job) {
        const url = this.constructDetailUrl(job.refnr);
        console.log(`🔍 Scraping job ${job.refnr}: ${job.titel} at ${job.arbeitgeber}`);
        
        let retryCount = 0;
        while (retryCount <= this.maxRetries) {
            try {
                await this.page.goto(url, { 
                    waitUntil: 'networkidle2', 
                    timeout: 30000 
                });

                // Check for CAPTCHA
                const captchaSelector = 'img[src*="captcha"]';
                const captchaImage = await this.page.$(captchaSelector);
                
                if (captchaImage) {
                    this.captchaCount++;
                    const pagesSinceLastCaptcha = this.pagesProcessed - this.lastCaptchaPage;
                    
                    console.log(`🧩 CAPTCHA detected on page ${this.pagesProcessed + 1} (CAPTCHA #${this.captchaCount})`);
                    console.log(`📊 Pages since last CAPTCHA: ${pagesSinceLastCaptcha}`);
                    
                    // Check if CAPTCHA appeared too soon (error condition)
                    if (this.captchaCount > 1 && pagesSinceLastCaptcha < this.minPagesBeforeCaptcha) {
                        console.error(`❌ CAPTCHA ERROR: Appeared after only ${pagesSinceLastCaptcha} pages (minimum: ${this.minPagesBeforeCaptcha})`);
                        console.error(`🚨 This indicates a problem - stopping extraction`);
                        throw new Error(`CAPTCHA frequency error: appeared after only ${pagesSinceLastCaptcha} pages`);
                    }
                    
                    console.log('🔧 Solving CAPTCHA...');
                    const captchaSolved = await this.solveCaptcha();
                    
                    if (!captchaSolved) {
                        throw new Error('CAPTCHA solving failed');
                    }
                    
                    this.lastCaptchaPage = this.pagesProcessed;
                    console.log(`✅ CAPTCHA solved successfully. Next expected after ~20 pages.`);
                    
                    // Wait for page to reload after CAPTCHA
                    await this.page.waitForTimeout(3000);
                }

                // Extract page content
                const pageContent = await this.page.content();
                
                // Extract emails using the email extractor
                const emails = this.emailExtractor.extractEmailsFromContent(pageContent);
                
                // Get company domain from job data or extract from page
                let companyDomain = '';
                if (job.arbeitsort_ort) {
                    companyDomain = this.emailExtractor.extractDomainFromEmployer(job.arbeitgeber);
                }

                // Determine best email
                const bestEmail = this.emailExtractor.filterAndCleanEmails(emails)[0] || '';

                const result = {
                    emails: emails,
                    bestEmail: bestEmail,
                    emailCount: emails.length,
                    companyDomain: companyDomain,
                    scrapingSuccess: emails.length > 0,
                    scrapingDuration: Date.now() - Date.now(), // Placeholder
                    hasEmails: emails.length > 0
                };

                console.log(`✅ Job ${job.refnr}: Found ${emails.length} emails${bestEmail ? ', best: ' + bestEmail : ''}`);
                
                // Increment page counter for CAPTCHA monitoring
                this.pagesProcessed++;
                return result;

            } catch (error) {
                retryCount++;
                console.log(`⚠️ Attempt ${retryCount} failed for job ${job.refnr}: ${error.message}`);
                
                if (retryCount <= this.maxRetries) {
                    console.log(`🔄 Retrying job ${job.refnr} in 5 seconds...`);
                    await this.page.waitForTimeout(5000);
                } else {
                    console.log(`❌ Max retries reached for job ${job.refnr}`);
                    return {
                        emails: [],
                        bestEmail: '',
                        emailCount: 0,
                        companyDomain: '',
                        scrapingSuccess: false,
                        scrapingDuration: 0,
                        hasEmails: false,
                        error: error.message
                    };
                }
            }
        }
    }

    /**
     * Solve CAPTCHA using the captcha solver
     */
    async solveCaptcha() {
        try {
            const captchaImgSelector = 'img[src*="captcha"]';
            const captchaImg = await this.page.$(captchaImgSelector);
            
            if (!captchaImg) {
                return false;
            }

            // Get CAPTCHA image source
            const captchaSrc = await captchaImg.evaluate(el => el.src);
            console.log('📸 CAPTCHA image source:', captchaSrc);

            // Solve CAPTCHA
            const solutionResult = await this.captchaSolver.solveCaptchaFromUrl(captchaSrc);
            const solution = solutionResult.success ? solutionResult.text : null;
            
            if (!solution) {
                console.log('❌ CAPTCHA solving failed');
                return false;
            }

            // Find input field and submit button
            const inputSelector = 'input[name="captcha"], input[type="text"]';
            const submitSelector = 'button[type="submit"], input[type="submit"]';

            // Enter CAPTCHA solution
            await this.page.type(inputSelector, solution);
            console.log('✏️ CAPTCHA solution entered:', solution);

            // Submit form
            await this.page.click(submitSelector);
            console.log('📤 CAPTCHA form submitted');

            // Wait for submission to process and verify CAPTCHA is gone
            console.log('⏳ Waiting for CAPTCHA verification...');
            
            // Wait up to 15 seconds for CAPTCHA to disappear
            let captchaGone = false;
            for (let i = 0; i < 15; i++) {
                await this.page.waitForTimeout(1000); // Wait 1 second
                
                // Check if CAPTCHA is still present
                const stillHasCaptcha = await this.page.$(captchaImgSelector);
                if (!stillHasCaptcha) {
                    captchaGone = true;
                    console.log(`✅ CAPTCHA disappeared after ${i + 1} seconds - solved successfully!`);
                    break;
                }
                
                console.log(`⌛ Still waiting for CAPTCHA to disappear... (${i + 1}/15 seconds)`);
            }
            
            if (!captchaGone) {
                console.log('❌ CAPTCHA still present after 15 seconds - solution may be incorrect');
                return false;
            }
            
            console.log('✅ CAPTCHA verification complete - proceeding to extract content');
            return true;

        } catch (error) {
            console.log('❌ CAPTCHA solving error:', error.message);
            return false;
        }
    }

    /**
     * Save scraping results to database
     */
    async saveResults(job, result) {
        const client = await this.pool.connect();
        try {
            const insertQuery = `
                INSERT INTO job_scrp_job_details (
                    reference_number, 
                    contact_emails, 
                    best_email, 
                    email_count,
                    company_domain,
                    scraping_success, 
                    scraping_duration_ms,
                    scraped_at,
                    has_emails
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
                ON CONFLICT (reference_number) 
                DO UPDATE SET 
                    contact_emails = EXCLUDED.contact_emails,
                    best_email = EXCLUDED.best_email,
                    email_count = EXCLUDED.email_count,
                    company_domain = EXCLUDED.company_domain,
                    scraping_success = EXCLUDED.scraping_success,
                    scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                    scraped_at = NOW(),
                    has_emails = EXCLUDED.has_emails
            `;

            await client.query(insertQuery, [
                job.refnr,
                result.emails.join(', '),
                result.bestEmail,
                result.emailCount,
                result.companyDomain,
                result.scrapingSuccess,
                result.scrapingDuration,
                result.hasEmails
            ]);

            console.log(`💾 Results saved for job ${job.refnr}`);

        } finally {
            client.release();
        }
    }

    /**
     * Process a list of targeted jobs with single browser instance
     */
    async processTargetedJobs(jobs, headlessMode = true) {
        console.log(`🎯 Starting targeted extraction for ${jobs.length} jobs (headless: ${headlessMode})`);
        
        await this.initializeBrowser(headlessMode);
        
        let processed = 0;
        let successful = 0;
        
        for (const job of jobs) {
            try {
                console.log(`\n📍 Processing ${processed + 1}/${jobs.length}: ${job.refnr}`);
                
                const result = await this.scrapeJobDetail(job);
                await this.saveResults(job, result);
                
                if (result.scrapingSuccess) {
                    successful++;
                }
                
                processed++;
                
                // Delay between requests (using single browser instance)
                if (processed < jobs.length) {
                    console.log(`⏳ Waiting ${this.delayBetweenRequests/1000}s before next job...`);
                    await this.page.waitForTimeout(this.delayBetweenRequests);
                }
                
            } catch (error) {
                console.error(`❌ Error processing job ${job.refnr}:`, error.message);
                processed++;
            }
        }
        
        console.log(`\n📊 Targeted extraction completed:`);
        console.log(`   Processed: ${processed}/${jobs.length}`);
        console.log(`   Successful: ${successful}/${processed}`);
        console.log(`   Success rate: ${processed > 0 ? Math.round((successful/processed) * 100) : 0}%`);
        console.log(`\n🧩 CAPTCHA Statistics:`);
        console.log(`   Total CAPTCHAs solved: ${this.captchaCount}`);
        console.log(`   Pages per CAPTCHA: ${this.captchaCount > 0 ? Math.round(this.pagesProcessed / this.captchaCount) : 'N/A'}`);
        console.log(`   CAPTCHA frequency: ${this.captchaCount > 0 ? 'Normal (~20 pages)' : 'No CAPTCHAs needed'}`);
        
        await this.cleanup();
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
}

// CLI interface for targeted extraction
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('❌ Usage: node targeted-detail-scraper.js <jobs-file.json>');
        process.exit(1);
    }
    
    const jobsFile = args[0];
    
    if (!fs.existsSync(jobsFile)) {
        console.error(`❌ Jobs file not found: ${jobsFile}`);
        process.exit(1);
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
        
        // Handle both old format (array) and new format (object)
        let jobs, headlessMode;
        if (Array.isArray(data)) {
            // Old format: just array of jobs
            jobs = data;
            headlessMode = true; // Default to headless
        } else {
            // New format: object with jobs and headlessMode
            jobs = data.jobs || [];
            headlessMode = data.headlessMode !== false; // Default to true
        }
        
        if (!Array.isArray(jobs) || jobs.length === 0) {
            console.error('❌ Invalid jobs file: must contain an array of job objects');
            process.exit(1);
        }
        
        console.log(`🎯 Loaded ${jobs.length} jobs for targeted extraction`);
        console.log(`🎯 Headless mode: ${headlessMode}`);
        
        const scraper = new TargetedDetailScraper();
        await scraper.processTargetedJobs(jobs, headlessMode);
        
        // Clean up temporary file
        try {
            fs.unlinkSync(jobsFile);
            console.log('🧹 Temporary jobs file cleaned up');
        } catch (error) {
            console.log('⚠️ Could not clean up temporary file:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = TargetedDetailScraper;