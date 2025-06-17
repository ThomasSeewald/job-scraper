const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

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
        
        // Create a persistent user data directory for cookies
        const fs = require('fs');
        const os = require('os');
        // Create unique cookie directory for this process
        const processId = process.pid;
        const userDataDir = path.join(os.homedir(), `.job-scraper-cookies-newest-${processId}`);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        
        console.log(`🍪 Using persistent cookie storage: ${userDataDir}`);
        
        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: userDataDir, // This ensures cookies persist
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
        
        // Only accept cookies on first run (cookies will persist with userDataDir)
        const cookieFile = path.join(userDataDir, 'cookies_accepted');
        if (!fs.existsSync(cookieFile)) {
            console.log('🍪 First run - navigating to main site to handle initial cookies...');
            await this.page.goto('https://www.arbeitsagentur.de', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
            
            // Wait longer for page and modal to load
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Accept cookies on initial page
            const cookiesAccepted = await this.acceptCookies();
            
            if (cookiesAccepted) {
                // Mark that cookies have been accepted
                fs.writeFileSync(cookieFile, 'true');
                console.log('✅ Cookies accepted and saved');
            }
        } else {
            console.log('✅ Using existing cookie preferences');
        }
        
        console.log('✅ Initial setup complete');
    }

    /**
     * Accept cookies if present on Arbeitsagentur pages
     */
    async acceptCookies() {
        try {
            // Try multiple approaches to find the cookie button
            const cookieButton = await this.page.waitForSelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]', {
                timeout: 15000,
                visible: true
            }).catch(() => null);
            
            if (!cookieButton) {
                // Try alternative selector
                const altButton = await this.page.$('button.gdpr-button-accept-all');
                if (!altButton) {
                    throw new Error('Cookie button not found with any selector');
                }
            }
            
            console.log('🍪 Cookie modal appeared!');
            
            // Click the accept button
            await this.page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            
            console.log('🔄 Waiting for modal to fully close...');
            
            // Wait longer and check multiple conditions
            await Promise.race([
                // Wait for button to be hidden
                this.page.waitForSelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]', {
                    hidden: true,
                    timeout: 10000
                }),
                // OR wait for modal container to disappear
                this.page.waitForSelector('[class*="cookie"]', {
                    hidden: true,
                    timeout: 10000
                }).catch(() => {}),
                // OR wait for backdrop to disappear
                this.page.waitForSelector('[class*="modal"]', {
                    hidden: true,
                    timeout: 10000
                }).catch(() => {})
            ]);
            
            // Additional wait for animations
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('✅ Cookie modal should be fully closed');
            return true;
            
        } catch (error) {
            console.log('❌ Cookie handling failed:', error.message);
            return false;
        }
    }

    /**
     * Get jobs that need detail scraping (no external URLs, not yet scraped)
     * Orders by publication date DESC to get newest first, one per employer
     */
    async getJobsToScrape(limit = 50) {
        const query = `
            WITH employers_with_emails AS (
              SELECT DISTINCT arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 
              WHERE (email IS NOT NULL AND email != '') 
                 OR (new_email IS NOT NULL AND new_email != '')
            ),
            employers_with_job_details AS (
              SELECT DISTINCT j.arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 j
              INNER JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
              WHERE jd.has_emails = true
            ),
            employers_with_external_urls AS (
              SELECT DISTINCT arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 
              WHERE externeurl IS NOT NULL AND externeurl != ''
            ),
            recent_jobs AS (
              SELECT 
                j.id,
                j.refnr,
                j.titel,
                j.arbeitgeber,
                j.arbeitsort_ort,
                j.aktuelleveroeffentlichungsdatum,
                ROW_NUMBER() OVER (PARTITION BY j.arbeitgeber ORDER BY j.aktuelleveroeffentlichungsdatum DESC, j.id DESC) as rn
              FROM job_scrp_arbeitsagentur_jobs_v2 j
              LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
              WHERE j.refnr IS NOT NULL
                AND (j.externeurl IS NULL OR j.externeurl = '')
                AND (j.email IS NULL OR j.email = '')
                AND (j.new_email IS NULL OR j.new_email = '')
                AND jd.reference_number IS NULL
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_emails)
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_job_details)
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_external_urls)
            )
            SELECT 
                id, refnr, titel, arbeitgeber, arbeitsort_ort, aktuelleveroeffentlichungsdatum
            FROM recent_jobs 
            WHERE rn = 1
            ORDER BY aktuelleveroeffentlichungsdatum DESC, refnr DESC
            LIMIT $1
        `;
        
        const client = await this.pool.connect();
        try {
            const result = await client.query(query, [limit]);
            console.log(`📋 Found ${result.rows.length} jobs ready for detail scraping (newest first, one per employer)`);
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
            const response = await this.page.goto(detailUrl, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });

            // Check if page returned 404
            if (response && response.status() === 404) {
                console.log('❌ Page returned 404 - job no longer exists');
                scrapingResult.success = false;
                scrapingResult.error = 'Page not found (404)';
                
                // Mark job as inactive in database
                await this.markJobAsInactive(job.refnr);
                
                return scrapingResult;
            }

            // Small delay to ensure page is loaded
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Quick check for "job doesn't exist" message BEFORE solving CAPTCHA
            const pageContent = await this.page.content();
            if (pageContent.includes('Dieses Stellenangebot gibt es nicht oder nicht mehr.')) {
                console.log('❌ Job no longer exists (detected before CAPTCHA) - skipping');
                scrapingResult.success = false;
                scrapingResult.error = 'Job no longer exists';
                
                // Mark job as inactive in database
                await this.markJobAsInactive(job.refnr);
                
                return scrapingResult;
            }

            // Check for CAPTCHA
            const captchaSolved = await this.detectAndSolveCaptcha();
            if (captchaSolved === true) {
                scrapingResult.captchaSolved = true;
                console.log('🔓 CAPTCHA solved, continuing...');
            } else if (captchaSolved === null) {
                // CAPTCHA was detected but not solved
                console.log('❌ CAPTCHA detected but could not be solved - marking as failed');
                scrapingResult.success = false;
                scrapingResult.error = 'CAPTCHA detected but not solved';
                return scrapingResult;
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

            scrapingResult = {
                ...scrapingResult,
                success: true,
                emails: emailResult.emails,
                bestEmail: emailResult.bestEmail,
                domain: emailResult.domain,
                emailCount: emailResult.emailCount,
                applicationWebsite: emailResult.applicationWebsite || ''
            };

            if (emailResult.emailCount > 0) {
                console.log(`✅ Found ${emailResult.emailCount} emails: ${emailResult.emails}`);
                if (emailResult.bestEmail) {
                    console.log(`🎯 Best email: ${emailResult.bestEmail}`);
                }
            } else if (emailResult.applicationWebsite) {
                console.log(`🌐 No emails found, but found application website: ${emailResult.applicationWebsite}`);
                console.log(`🏢 Domain: ${emailResult.domain}`);
            } else {
                console.log(`❌ No emails or application website found`);
            }

        } catch (error) {
            console.error(`❌ Error scraping ${job.refnr}:`, error.message);
            scrapingResult.error = error.message;
            
            // Handle detached frame errors by marking as failed
            if (error.message.includes('detached Frame') || error.message.includes('Execution context was destroyed')) {
                console.log('⚠️ Detached frame error - likely cookie modal interference');
                scrapingResult.success = false;
                scrapingResult.error = 'Cookie modal or navigation error - needs retry';
            }
        }

        scrapingResult.duration = Date.now() - startTime;
        return scrapingResult;
    }

    /**
     * Detect and solve CAPTCHA if present (using production patterns from cron jobs)
     * @returns {boolean|null} true if CAPTCHA solved, false if no CAPTCHA, null if CAPTCHA detected but not solved
     */
    async detectAndSolveCaptcha() {
        const maxRetries = 3;
        let captchaDetected = false;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Use multiple selector patterns like production code
                const captchaSelectors = [
                    'img[src*="captcha"]',
                    'img[alt*="captcha"]', 
                    'img[alt*="Captcha"]',
                    'img[alt*="CAPTCHA"]',
                    '.captcha img',
                    '#captcha img'
                ];
                
                let captchaImage = null;
                for (const selector of captchaSelectors) {
                    captchaImage = await this.page.$(selector);
                    if (captchaImage) break;
                }
                
                if (!captchaImage) {
                    return false; // No CAPTCHA detected
                }
                
                captchaDetected = true;

                console.log(`🔒 CAPTCHA detected, solving... (attempt ${attempt}/${maxRetries})`);

                // Extract image URL from DOM (production pattern)
                const captchaImageUrl = await this.page.evaluate(() => {
                    const images = document.querySelectorAll('img');
                    for (const img of images) {
                        if (img.src && (img.src.includes('captcha') || 
                            (img.alt && img.alt.toLowerCase().includes('captcha')))) {
                            return img.src;
                        }
                    }
                    return null;
                });
                
                if (!captchaImageUrl) {
                    console.log('❌ Could not extract CAPTCHA image URL from DOM');
                    continue;
                }
                
                console.log(`🖼️ CAPTCHA image URL: ${captchaImageUrl}`);
                
                // Use the CAPTCHA solver's built-in URL download method
                const solution = await this.captchaSolver.solveCaptchaFromUrl(captchaImageUrl);
                
                if (solution.success) {
                    // Validate solution length (Arbeitsagentur uses 6 characters)
                    if (!solution.text || solution.text.length !== 6) {
                        console.log(`❌ Invalid CAPTCHA solution length: ${solution.text?.length} (expected 6 characters)`);
                        continue;
                    }
                    
                    console.log(`🔑 CAPTCHA solution: ${solution.text}`);
                    
                    // Use exact production pattern for form submission
                    console.log(`🔤 Entering CAPTCHA solution: '${solution.text}' into input field...`);
                    
                    await this.page.evaluate((captchaSolution) => {
                        var captchaInput = document.getElementById('kontaktdaten-captcha-input');
                        if (captchaInput) {
                            captchaInput.value = '';
                            captchaInput.value = captchaSolution;
                            
                            // Dispatch events to ensure proper detection
                            var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                            var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                            captchaInput.dispatchEvent(inputEvent);
                            captchaInput.dispatchEvent(changeEvent);
                            captchaInput.focus();
                            captchaInput.blur();
                        }
                    }, solution.text);
                    
                    console.log('🔤 CAPTCHA solution entered, waiting before clicking submit...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Click the specific submit button using production pattern
                    const clicked = await this.page.evaluate(() => {
                        var element = document.querySelector('#kontaktdaten-captcha-absenden-button');
                        if (element) {
                            element.click();
                            return true;
                        }
                        return false;
                    });
                    
                    if (clicked) {
                        console.log('🔘 Submit button clicked, waiting for CAPTCHA validation...');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    } else {
                        console.log('❌ Submit button not found');
                        continue;
                    }
                    
                    // Validate using production pattern: check for absence of "sicherheitsabfrage"
                    const pageText = await this.page.evaluate(() => document.body.textContent.toLowerCase());
                    
                    if (!pageText.includes('sicherheitsabfrage')) {
                        console.log(`✅ CAPTCHA solved successfully on attempt ${attempt}!`);
                        return true;
                    } else {
                        console.log(`❌ CAPTCHA solution rejected (sicherheitsabfrage still present), retrying... (attempt ${attempt}/${maxRetries})`);
                        if (attempt === maxRetries) {
                            console.log('❌ All CAPTCHA attempts failed');
                            return null; // CAPTCHA detected but not solved
                        }
                        // Continue to next attempt
                    }
                } else {
                    console.log(`❌ CAPTCHA solving service failed on attempt ${attempt}: ${solution.error}`);
                    if (attempt === maxRetries) {
                        return captchaDetected ? null : false;
                    }
                    // Continue to next attempt
                }
                
            } catch (error) {
                console.log(`❌ CAPTCHA handling error on attempt ${attempt}:`, error.message);
                if (attempt === maxRetries) {
                    return captchaDetected ? null : false;
                }
                // Continue to next attempt
            }
        }
        
        return captchaDetected ? null : false;
    }

    /**
     * Save scraping results to database (job_scrp_job_details + job_scrp_employers table)
     */
    async saveResults(job, scrapingResult) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. Save to job_scrp_job_details table (for individual job tracking)
            const jobDetailsQuery = `
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
                    source_url
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10, $11, $12)
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
                    source_url = EXCLUDED.source_url
            `;

            const detailUrl = this.constructDetailUrl(job.refnr);
            const jobDetailsValues = [
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
                detailUrl
            ];

            await client.query(jobDetailsQuery, jobDetailsValues);

            // 2. Update job_scrp_employers table with website and/or email info
            await this.updateEmployerInfo(client, job.arbeitgeber, scrapingResult);

            await client.query('COMMIT');
            console.log(`💾 Saved results for ${job.refnr} (job_scrp_job_details + job_scrp_employers)`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Database save error for ${job.refnr}:`, error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Update employer information in job_scrp_employers table
     */
    async updateEmployerInfo(client, employerName, scrapingResult) {
        // First, ensure employer exists in job_scrp_employers table
        const ensureEmployerQuery = `
            INSERT INTO job_scrp_employers (name, normalized_name, first_seen, last_updated)
            VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (normalized_name) DO UPDATE SET
                last_updated = CURRENT_TIMESTAMP
            RETURNING id
        `;
        
        const normalizedName = employerName.toLowerCase().trim();
        const employerResult = await client.query(ensureEmployerQuery, [employerName, normalizedName]);
        
        // Update employer with extracted information
        const updateParts = [];
        const updateValues = [];
        let valueIndex = 1;
        
        // Update website if we found one
        if (scrapingResult.applicationWebsite) {
            updateParts.push(`website = $${valueIndex}`);
            updateValues.push(scrapingResult.applicationWebsite);
            valueIndex++;
        }
        
        // Update email info if we found emails
        if (scrapingResult.emailCount > 0) {
            updateParts.push(`contact_emails = $${valueIndex}`);
            updateValues.push(scrapingResult.emails);
            valueIndex++;
            
            updateParts.push(`best_email = $${valueIndex}`);
            updateValues.push(scrapingResult.bestEmail);
            valueIndex++;
            
            updateParts.push(`has_emails = true`);
        }
        
        // Update domain if we have one
        if (scrapingResult.domain) {
            updateParts.push(`company_domain = $${valueIndex}`);
            updateValues.push(scrapingResult.domain);
            valueIndex++;
        }
        
        // Mark that email extraction was attempted
        updateParts.push(`email_extraction_attempted = true`);
        updateParts.push(`email_extraction_date = CURRENT_TIMESTAMP`);
        updateParts.push(`last_updated = CURRENT_TIMESTAMP`);
        
        if (updateParts.length > 0) {
            updateValues.push(normalizedName);
            const updateEmployerQuery = `
                UPDATE job_scrp_employers 
                SET ${updateParts.join(', ')}
                WHERE normalized_name = $${valueIndex}
            `;
            
            await client.query(updateEmployerQuery, updateValues);
            
            const updateType = scrapingResult.applicationWebsite ? 'website' : 'emails';
            console.log(`🏢 Updated employer "${employerName}" with ${updateType}`);
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
     * Mark a job as inactive when it no longer exists
     */
    async markJobAsInactive(refnr) {
        const query = `
            UPDATE job_scrp_arbeitsagentur_jobs_v2 
            SET 
                is_active = false,
                old = true,
                last_updated = CURRENT_TIMESTAMP
            WHERE refnr = $1
        `;
        
        const client = await this.pool.connect();
        try {
            await client.query(query, [refnr]);
            console.log(`📝 Marked job ${refnr} as inactive`);
        } catch (error) {
            console.error(`❌ Error marking job as inactive: ${error.message}`);
        } finally {
            client.release();
        }
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