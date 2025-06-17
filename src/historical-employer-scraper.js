const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

class HistoricalEmployerScraper {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.emailExtractor = new EmailExtractor();
        this.captchaSolver = new IndependentCaptchaSolver();
        this.browser = null;
        this.page = null;
        
        // Configuration
        this.batchSize = 20; // Process 20 historical job_scrp_employers at a time
        this.delayBetweenRequests = 3000; // 3 seconds between requests (slower for historical)
        this.maxRetries = 2;
        
        this.progressFile = path.join(__dirname, '../historical-progress.json');
    }

    /**
     * Initialize browser and page
     */
    async initializeBrowser() {
        console.log('🚀 Initializing browser for historical scraping...');
        
        // Use headless mode for background operation
        const isHeadless = process.env.HEADLESS_MODE === 'true' || process.argv.includes('--headless');
        console.log(`🖥️ Browser mode: ${isHeadless ? 'headless (background)' : 'visible (interactive)'}`);
        
        // Create unique cookie directory for this process
        const os = require('os');
        const processId = process.pid;
        const userDataDir = path.join(os.homedir(), `.job-scraper-cookies-historical-${processId}`);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        
        console.log(`🍪 Using persistent cookie storage: ${userDataDir}`);
        
        this.browser = await puppeteer.launch({
            headless: isHeadless,
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
        
        console.log('✅ Browser initialized for historical scraping');
        
        // Only accept cookies on first run (cookies will persist with userDataDir)
        const cookieFile = path.join(userDataDir, 'cookies_accepted');
        if (!fs.existsSync(cookieFile)) {
            console.log('🍪 First run - navigating to main site to handle initial cookies...');
            await this.page.goto('https://www.arbeitsagentur.de', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
            
            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Accept cookies
            const cookiesAccepted = await this.acceptCookies();
            
            if (cookiesAccepted) {
                // Mark that cookies have been accepted
                fs.writeFileSync(cookieFile, 'true');
                console.log('✅ Cookies accepted and saved');
            }
        } else {
            console.log('✅ Using existing cookie preferences');
        }
    }
    
    /**
     * Accept cookies if present on Arbeitsagentur pages
     */
    async acceptCookies() {
        try {
            await this.page.waitForSelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]', {
                timeout: 10000,
                visible: true
            });
            
            console.log('🍪 Cookie modal found, accepting cookies...');
            
            // Click the accept button
            await this.page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            
            console.log('🔄 Waiting for modal to close...');
            
            // Wait for modal to disappear
            await Promise.race([
                this.page.waitForSelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]', {
                    hidden: true,
                    timeout: 10000
                }),
                new Promise(resolve => setTimeout(resolve, 3000))
            ]);
            
            console.log('✅ Cookies accepted successfully');
            return true;
            
        } catch (error) {
            console.log('❌ Cookie handling failed or no modal found:', error.message);
            return false;
        }
    }

    /**
     * Get or load progress tracking
     */
    getProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                return JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
            }
        } catch (error) {
            console.log(`⚠️ Error reading progress file: ${error.message}`);
        }
        
        // Initialize progress
        return {
            lastProcessedId: 0,
            totalProcessed: 0,
            successfulExtractions: 0,
            startDate: new Date().toISOString()
        };
    }

    /**
     * Save progress
     */
    saveProgress(progress) {
        fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
    }

    /**
     * Get next batch of historical job_scrp_employers to scrape
     */
    async getHistoricalEmployersBatch() {
        const progress = this.getProgress();
        
        const query = `
            WITH employer_newest_jobs AS (
                SELECT 
                    e.id,
                    e.name,
                    e.normalized_name,
                    j.refnr,
                    j.titel,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.aktuelleveroeffentlichungsdatum,
                    ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY j.aktuelleveroeffentlichungsdatum DESC) as rn
                FROM job_scrp_employers e
                INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
                WHERE (e.email_extraction_attempted = false OR e.email_extraction_attempted IS NULL)
                    AND (e.contact_emails IS NULL OR e.contact_emails = '')
                    AND (e.website IS NULL OR e.website = '')
                    AND e.id > $1
                    AND (j.externeurl IS NULL OR j.externeurl = '')
                    AND j.refnr IS NOT NULL
                    AND j.is_active = true
            )
            SELECT 
                id,
                name,
                normalized_name,
                refnr,
                titel,
                arbeitsort_ort,
                arbeitsort_plz,
                aktuelleveroeffentlichungsdatum
            FROM employer_newest_jobs 
            WHERE rn = 1
            ORDER BY aktuelleveroeffentlichungsdatum DESC, id ASC
            LIMIT $2
        `;
        
        const client = await this.pool.connect();
        try {
            const result = await client.query(query, [progress.lastProcessedId, this.batchSize]);
            
            // Deduplicate by employer (take newest job per employer)
            const employerMap = new Map();
            result.rows.forEach(row => {
                if (!employerMap.has(row.id) || 
                    new Date(row.aktuelleveroeffentlichungsdatum) > new Date(employerMap.get(row.id).aktuelleveroeffentlichungsdatum)) {
                    employerMap.set(row.id, row);
                }
            });
            
            const job_scrp_employers = Array.from(employerMap.values());
            
            console.log(`📋 Found ${job_scrp_employers.length} historical job_scrp_employers for extraction (batch starting from ID ${progress.lastProcessedId})`);
            return { job_scrp_employers, progress };
            
        } finally {
            client.release();
        }
    }

    /**
     * Get total count of remaining historical job_scrp_employers
     */
    async getTotalHistoricalCount() {
        const query = `
            SELECT COUNT(DISTINCT e.id) as total
            FROM job_scrp_employers e
            INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
            WHERE (e.email_extraction_attempted = false OR e.email_extraction_attempted IS NULL)
                AND (e.contact_emails IS NULL OR e.contact_emails = '')
                AND (e.website IS NULL OR e.website = '')
                AND (j.externeurl IS NULL OR j.externeurl = '')
                AND j.refnr IS NOT NULL
                AND j.is_active = true
        `;
        
        const client = await this.pool.connect();
        try {
            const result = await client.query(query);
            return parseInt(result.rows[0].total);
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
     * Scrape detail page for a historical employer
     */
    async scrapeHistoricalEmployer(employer) {
        const startTime = Date.now();
        let scrapingResult = {
            success: false,
            emails: '',
            bestEmail: '',
            domain: '',
            emailCount: 0,
            captchaSolved: false,
            error: null,
            duration: 0,
            applicationWebsite: ''
        };

        try {
            const detailUrl = this.constructDetailUrl(employer.refnr);
            console.log(`🔍 Historical scraping: ${employer.name}`);
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
                await this.markJobAsInactive(employer.refnr);
                
                return scrapingResult;
            }

            // Quick check for "job doesn't exist" message BEFORE solving CAPTCHA
            const pageContent = await this.page.content();
            if (pageContent.includes('Dieses Stellenangebot gibt es nicht oder nicht mehr.')) {
                console.log('❌ Job no longer exists (detected before CAPTCHA) - skipping');
                scrapingResult.success = false;
                scrapingResult.error = 'Job no longer exists';
                
                // Mark job as inactive in database
                await this.markJobAsInactive(employer.refnr);
                
                return scrapingResult;
            }

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
            
            // Check if job doesn't exist
            if (html.includes('Dieses Stellenangebot gibt es nicht oder nicht mehr.')) {
                console.log('❌ Job no longer exists - marking as attempted');
                scrapingResult.success = true; // Mark as success to avoid retrying
                scrapingResult.error = 'Job no longer exists';
                return scrapingResult;
            }
            
            // Extract emails using our focused email extractor
            const emailResult = this.emailExtractor.extractPrioritizedEmails(
                html, 
                employer.titel, 
                employer.name
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
            console.error(`❌ Error scraping historical employer ${employer.name}:`, error.message);
            scrapingResult.error = error.message;
        }

        scrapingResult.duration = Date.now() - startTime;
        return scrapingResult;
    }

    /**
     * Detect and solve CAPTCHA if present (same logic as newest-jobs-scraper)
     */
    async detectAndSolveCaptcha() {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Use multiple selector patterns
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

                console.log(`🔒 CAPTCHA detected, solving... (attempt ${attempt}/${maxRetries})`);

                // Extract image URL from DOM
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
                
                // Use the CAPTCHA solver
                const solution = await this.captchaSolver.solveCaptchaFromUrl(captchaImageUrl);
                
                if (solution.success) {
                    // Validate solution length (Arbeitsagentur uses 6 characters)
                    if (!solution.text || solution.text.length !== 6) {
                        console.log(`❌ Invalid CAPTCHA solution length: ${solution.text?.length} (expected 6 characters)`);
                        continue;
                    }
                    
                    console.log(`🔑 CAPTCHA solution: ${solution.text}`);
                    
                    // Use production pattern for form submission
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
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Click the submit button
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
                    
                    // Validate using production pattern
                    const pageText = await this.page.evaluate(() => document.body.textContent.toLowerCase());
                    
                    if (!pageText.includes('sicherheitsabfrage')) {
                        console.log(`✅ CAPTCHA solved successfully on attempt ${attempt}!`);
                        return true;
                    } else {
                        console.log(`❌ CAPTCHA solution rejected, retrying... (attempt ${attempt}/${maxRetries})`);
                        if (attempt === maxRetries) {
                            console.log('❌ All CAPTCHA attempts failed');
                            return false;
                        }
                    }
                } else {
                    console.log(`❌ CAPTCHA solving service failed on attempt ${attempt}: ${solution.error}`);
                    if (attempt === maxRetries) {
                        return false;
                    }
                }
                
            } catch (error) {
                console.log(`❌ CAPTCHA handling error on attempt ${attempt}:`, error.message);
                if (attempt === maxRetries) {
                    return false;
                }
            }
        }
        
        return false;
    }

    /**
     * Save scraping results to database (same logic as newest-jobs-scraper)
     */
    async saveHistoricalResults(employer, scrapingResult) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. Update employer with extraction results
            await this.updateHistoricalEmployerInfo(client, employer.id, employer.name, scrapingResult);

            await client.query('COMMIT');
            console.log(`💾 Saved historical results for employer: ${employer.name}`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Database save error for historical employer ${employer.name}:`, error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Update employer information with historical extraction results
     */
    async updateHistoricalEmployerInfo(client, employerId, employerName, scrapingResult) {
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
        
        updateValues.push(employerId);
        const updateEmployerQuery = `
            UPDATE job_scrp_employers 
            SET ${updateParts.join(', ')}
            WHERE id = $${valueIndex}
        `;
        
        await client.query(updateEmployerQuery, updateValues);
        
        const updateType = scrapingResult.applicationWebsite ? 'website' : 
                          scrapingResult.emailCount > 0 ? 'emails' : 'attempted';
        console.log(`🏢 Updated historical employer "${employerName}" with ${updateType}`);
    }

    /**
     * Process a batch of historical job_scrp_employers
     */
    async processHistoricalBatch(job_scrp_employers, progress) {
        console.log(`\\n🔄 Processing historical batch of ${job_scrp_employers.length} job_scrp_employers...`);
        
        let successCount = 0;
        let emailsFoundCount = 0;
        let websitesFoundCount = 0;

        for (const employer of job_scrp_employers) {
            try {
                const result = await this.scrapeHistoricalEmployer(employer);
                await this.saveHistoricalResults(employer, result);

                if (result.success) {
                    successCount++;
                    if (result.emailCount > 0) {
                        emailsFoundCount++;
                    } else if (result.applicationWebsite) {
                        websitesFoundCount++;
                    }
                }

                // Update progress
                progress.lastProcessedId = employer.id;
                progress.totalProcessed++;
                if (result.emailCount > 0 || result.applicationWebsite) {
                    progress.successfulExtractions++;
                }
                this.saveProgress(progress);

                // Delay between requests (slower for historical)
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests));

            } catch (error) {
                console.error(`❌ Failed to process historical employer ${employer.name}:`, error.message);
            }
        }

        console.log(`\\n📊 Historical batch completed: ${successCount}/${job_scrp_employers.length} successful`);
        console.log(`   📧 Emails found: ${emailsFoundCount}`);
        console.log(`   🌐 Websites found: ${websitesFoundCount}`);
        
        return { successCount, emailsFoundCount, websitesFoundCount, totalEmployers: job_scrp_employers.length };
    }

    /**
     * Main historical scraping process
     */
    async startHistoricalScraping(maxEmployers = 100) {
        try {
            console.log('🏛️ Starting Historical Employer Scraper');
            console.log('📧 Focus: Extract emails from historical job_scrp_employers');
            console.log('🐌 Strategy: Slower, comprehensive approach');

            await this.initializeBrowser();

            const totalRemaining = await this.getTotalHistoricalCount();
            console.log(`📊 Total historical job_scrp_employers remaining: ${totalRemaining.toLocaleString()}`);

            const { job_scrp_employers, progress } = await this.getHistoricalEmployersBatch();
            
            if (job_scrp_employers.length === 0) {
                console.log('✅ No historical job_scrp_employers found for scraping');
                return;
            }

            // Limit to maxEmployers
            const limitedEmployers = job_scrp_employers.slice(0, maxEmployers);
            console.log(`🎯 Processing ${limitedEmployers.length} historical job_scrp_employers (limited from ${job_scrp_employers.length})`);

            const batchStats = await this.processHistoricalBatch(limitedEmployers, progress);

            console.log('\\n🎉 Historical scraping completed!');
            console.log(`📊 Final Stats:`);
            console.log(`   Total job_scrp_employers processed: ${batchStats.totalEmployers}`);
            console.log(`   Successful scrapes: ${batchStats.successCount}`);
            console.log(`   Emails found: ${batchStats.emailsFoundCount}`);
            console.log(`   Websites found: ${batchStats.websitesFoundCount}`);
            console.log(`   Success rate: ${((batchStats.successCount / batchStats.totalEmployers) * 100).toFixed(1)}%`);
            console.log(`   Total progress: ${progress.totalProcessed} job_scrp_employers processed since ${progress.startDate}`);
            console.log(`   Remaining: ~${(totalRemaining - progress.totalProcessed).toLocaleString()} job_scrp_employers`);

        } catch (error) {
            console.error('❌ Fatal error in historical scraping:', error.message);
        } finally {
            await this.cleanup();
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
    async getHistoricalStats() {
        const query = `
            SELECT 
                COUNT(*) as total_historical_employers,
                COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as with_emails,
                COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_websites,
                MAX(email_extraction_date) as last_extraction
            FROM job_scrp_employers
        `;

        const client = await this.pool.connect();
        try {
            const result = await client.query(query);
            return result.rows[0];
        } finally {
            client.release();
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
}

// CLI interface
async function main() {
    const scraper = new HistoricalEmployerScraper();
    
    const args = process.argv.slice(2);
    const maxEmployers = args[0] ? parseInt(args[0]) : 50;

    console.log(`Starting historical employer scraper for up to ${maxEmployers} job_scrp_employers...`);
    
    try {
        await scraper.startHistoricalScraping(maxEmployers);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = HistoricalEmployerScraper;