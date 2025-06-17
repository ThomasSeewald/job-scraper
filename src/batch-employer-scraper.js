const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');
const DomainEmailExtractor = require('./domain-email-extractor');
const PortalDetector = require('./portal-detector');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

class BatchEmployerScraper {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.emailExtractor = new EmailExtractor();
        this.captchaSolver = new IndependentCaptchaSolver();
        this.domainExtractor = new DomainEmailExtractor();
        this.portalDetector = new PortalDetector();
        this.browser = null;
        this.page = null;
        this.userDataDir = null; // For cleanup
        
        // Configuration
        this.delayBetweenRequests = 3000; // 3 seconds between requests
        this.maxRetries = 2;
        
        // CAPTCHA frequency monitoring
        this.captchaCount = 0;
        this.pagesProcessed = 0;
        this.lastCaptchaPage = 0;
        this.minPagesBeforeCaptcha = 15; // Error if CAPTCHA appears sooner
        
        // Process tracking
        this.processId = process.env.PROCESS_ID || '1';
        this.isParallelMode = process.env.PARALLEL_MODE === 'true';
        
        console.log(`🎯 Batch Employer Scraper initialized (Process ${this.processId})`);
    }

    /**
     * Initialize browser and page
     */
    async initializeBrowser() {
        console.log(`🚀 [P${this.processId}] Initializing browser...`);
        
        // Use headless mode for parallel processing
        const isHeadless = process.env.HEADLESS_MODE === 'true' || process.argv.includes('--headless');
        
        // Create unique user data directory for this process to avoid cookie sharing
        const fs = require('fs');
        const os = require('os');
        this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `puppeteer-profile-p${this.processId}-`));
        console.log(`🗂️ [P${this.processId}] Using unique user data directory: ${this.userDataDir}`);

        this.browser = await puppeteer.launch({
            headless: isHeadless,
            userDataDir: this.userDataDir,
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
        
        console.log(`✅ [P${this.processId}] Browser initialized (headless: ${isHeadless})`);
        
        // Navigate to the main site to accept cookies once
        try {
            console.log(`🍪 [P${this.processId}] Navigating to main site to handle initial cookie consent...`);
            await this.page.goto('https://www.arbeitsagentur.de', { waitUntil: 'networkidle2', timeout: 20000 });
            await this.acceptCookieConsent();
            console.log(`✅ [P${this.processId}] Initial cookie setup complete`);
        } catch (error) {
            console.log(`⚠️ [P${this.processId}] Could not complete initial cookie setup: ${error.message}`);
        }
    }

    /**
     * Process batch file of employers
     */
    async processBatchFile(batchFile) {
        console.log(`📁 [P${this.processId}] Loading batch file: ${batchFile}`);
        
        const employers = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
        console.log(`✅ [P${this.processId}] Loaded ${employers.length} employers from batch`);
        
        let processed = 0;
        let successful = 0;
        let emailsFound = 0;
        let websitesFound = 0;
        let domainEmailsFound = 0;
        
        for (const employer of employers) {
            try {
                console.log(`\\n🔍 [P${this.processId}] Processing employer ${processed + 1}/${employers.length}: ${employer.name}`);
                console.log(`🔗 [P${this.processId}] URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/${employer.refnr}`);
                
                const result = await this.scrapeEmployerDetails(employer);
                await this.saveEmployerResults(employer, result);
                
                if (result.success) {
                    successful++;
                    if (result.hasEmails) emailsFound++;
                    if (result.hasWebsite) websitesFound++;
                    if (result.hasDomainEmails) domainEmailsFound++;
                }
                
                processed++;
                
                // Progress logging for parent process parsing
                console.log(`📊 [P${this.processId}] Processed: ${processed}, Successful: ${successful}, Emails found: ${emailsFound}, Websites found: ${websitesFound}, Domain emails: ${domainEmailsFound}`);
                
                // Delay between requests (using single browser instance)
                if (processed < employers.length) {
                    console.log(`⏳ [P${this.processId}] Waiting ${this.delayBetweenRequests/1000}s before next employer...`);
                    await this.delay(this.delayBetweenRequests);
                }
                
            } catch (error) {
                console.error(`❌ [P${this.processId}] Error processing employer ${employer.name}:`, error.message);
                processed++;
            }
        }
        
        console.log(`\\n📊 [P${this.processId}] Batch completed:`);
        console.log(`   Processed: ${processed}/${employers.length}`);
        console.log(`   Successful: ${successful}/${processed}`);
        console.log(`   Emails found: ${emailsFound}`);
        console.log(`   Websites found: ${websitesFound}`);
        console.log(`   Domain emails found: ${domainEmailsFound}`);
        console.log(`   Success rate: ${processed > 0 ? Math.round((successful/processed) * 100) : 0}%`);
        console.log(`\\n🧩 [P${this.processId}] CAPTCHA Statistics:`);
        console.log(`   Total CAPTCHAs solved: ${this.captchaCount}`);
        console.log(`   Pages per CAPTCHA: ${this.captchaCount > 0 ? Math.round(this.pagesProcessed / this.captchaCount) : 'N/A'}`);
        console.log(`   CAPTCHA frequency: ${this.captchaCount > 0 ? 'Normal (~20 pages)' : 'No CAPTCHAs needed'}`);
    }

    /**
     * Scrape detailed information from a job listing for employer contact info
     */
    async scrapeEmployerDetails(employer) {
        const url = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${employer.refnr}`;
        
        let retryCount = 0;
        while (retryCount <= this.maxRetries) {
            try {
                await this.page.goto(url, { 
                    waitUntil: 'networkidle2', 
                    timeout: 30000 
                });

                // Accept cookie consent if present
                await this.acceptCookieConsent();

                // Scroll to contact information section immediately after page loads
                try {
                    await this.page.evaluate(() => {
                        const contactHeading = document.querySelector('h3#jobdetails-kontaktdaten-heading');
                        if (contactHeading) {
                            contactHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            console.log('📍 Scrolled to contact information section');
                        }
                    });
                    // Give time for any lazy-loaded content
                    await this.delay(1000);
                } catch (scrollError) {
                    // Non-critical error, continue processing
                    console.log(`⚠️ [P${this.processId}] Could not scroll to contact section: ${scrollError.message}`);
                }

                // Check for CAPTCHA
                const captchaSelector = 'img[src*="captcha"]';
                const captchaImage = await this.page.$(captchaSelector);
                
                if (captchaImage) {
                    this.captchaCount++;
                    const pagesSinceLastCaptcha = this.pagesProcessed - this.lastCaptchaPage;
                    
                    console.log(`🧩 [P${this.processId}] CAPTCHA detected on page ${this.pagesProcessed + 1} (CAPTCHA #${this.captchaCount})`);
                    console.log(`📊 [P${this.processId}] Pages since last CAPTCHA: ${pagesSinceLastCaptcha}`);
                    
                    // Check if CAPTCHA appeared too soon (error condition)
                    if (this.captchaCount > 1 && pagesSinceLastCaptcha < this.minPagesBeforeCaptcha) {
                        console.error(`❌ [P${this.processId}] CAPTCHA ERROR: Appeared after only ${pagesSinceLastCaptcha} pages (minimum: ${this.minPagesBeforeCaptcha})`);
                        console.error(`🚨 [P${this.processId}] This indicates a problem - stopping extraction`);
                        throw new Error(`CAPTCHA frequency error: appeared after only ${pagesSinceLastCaptcha} pages`);
                    }
                    
                    console.log(`🔧 [P${this.processId}] Solving CAPTCHA...`);
                    const captchaSolved = await this.solveCaptcha();
                    
                    if (!captchaSolved) {
                        throw new Error('CAPTCHA solving failed');
                    }
                    
                    this.lastCaptchaPage = this.pagesProcessed;
                    console.log(`✅ [P${this.processId}] CAPTCHA solved successfully. Next expected after ~20 pages.`);
                    
                    // Wait for page to reload after CAPTCHA
                    await this.delay(3000);
                    
                    // Accept cookie consent again if it reappears after CAPTCHA
                    await this.acceptCookieConsent();
                    
                    // Scroll again after CAPTCHA is solved and page reloads
                    try {
                        await this.page.evaluate(() => {
                            const contactHeading = document.querySelector('h3#jobdetails-kontaktdaten-heading');
                            if (contactHeading) {
                                contactHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                console.log('📍 Scrolled to contact information section after CAPTCHA');
                            }
                        });
                        await this.delay(1000);
                    } catch (scrollError) {
                        console.log(`⚠️ [P${this.processId}] Could not scroll after CAPTCHA: ${scrollError.message}`);
                    }
                }

                // Extract page content
                const pageContent = await this.page.content();
                
                // Extract emails using the email extractor (enhanced approach)
                const emailResult = this.emailExtractor.extractEmails(pageContent, employer.titel, employer.name);
                let emails = emailResult.emails ? emailResult.emails.split(', ').filter(e => e.trim()) : [];
                let bestEmail = emailResult.bestEmail || '';
                let website = emailResult.applicationWebsite || '';
                let companyDomain = emailResult.domain || '';

                // If no emails found but we have a website, try domain email extraction
                let domainEmailsFound = [];
                let portalDetectionResult = null;
                
                if (emails.length === 0 && website) {
                    console.log(`🌐 [P${this.processId}] No direct emails found, attempting domain extraction from: ${website}`);
                    
                    // First, check if the website is a portal/service platform
                    portalDetectionResult = this.portalDetector.detectPortal(website);
                    console.log(`🔍 [P${this.processId}] Portal detection: ${portalDetectionResult.isPortal ? 'PORTAL' : 'LEGITIMATE'} (${portalDetectionResult.confidence.toFixed(2)} confidence)`);
                    console.log(`📝 [P${this.processId}] Detection reason: ${portalDetectionResult.reason}`);
                    
                    if (portalDetectionResult.isPortal && portalDetectionResult.confidence >= 0.8) {
                        console.log(`🚫 [P${this.processId}] Skipping domain extraction - website detected as ${portalDetectionResult.category}`);
                    } else {
                        try {
                            // Extract domain from website
                            const domain = this.emailExtractor.extractDomainFromUrl(website);
                            if (domain) {
                                console.log(`🎯 [P${this.processId}] Proceeding with domain extraction from: ${domain}`);
                                
                                // Use existing domain email extractor to find emails on company website
                                const domainResult = await this.domainExtractor.processDomain({
                                    domain: domain,
                                    base_domain: domain,
                                    frequency: 1
                                });
                                
                                if (domainResult.success && domainResult.emails.length > 0) {
                                    domainEmailsFound = domainResult.emails;
                                    emails = domainResult.emails;
                                    bestEmail = domainResult.emails[0];
                                    companyDomain = domain;
                                    console.log(`🎯 [P${this.processId}] Domain extraction found ${domainResult.emails.length} emails: ${domainResult.emails.join(', ')}`);
                                } else {
                                    console.log(`❌ [P${this.processId}] Domain extraction yielded no emails from ${domain}`);
                                }
                            }
                        } catch (domainError) {
                            console.log(`⚠️ [P${this.processId}] Domain extraction error: ${domainError.message}`);
                        }
                    }
                }

                // If still no website found, try to extract one from the page
                if (!website && emails.length === 0) {
                    website = await this.extractWebsite();
                }

                const result = {
                    emails: emails,
                    bestEmail: bestEmail,
                    website: website,
                    companyDomain: companyDomain,
                    domainEmailsFound: domainEmailsFound,
                    portalDetection: portalDetectionResult,
                    hasEmails: emails.length > 0,
                    hasWebsite: website.length > 0,
                    hasDomainEmails: domainEmailsFound.length > 0,
                    isPortalWebsite: portalDetectionResult?.isPortal || false,
                    success: true
                };

                console.log(`✅ [P${this.processId}] Employer ${employer.name}: Found ${emails.length} emails${bestEmail ? ', best: ' + bestEmail : ''}${website ? ', website: ' + website : ''}${domainEmailsFound.length > 0 ? ` (${domainEmailsFound.length} from domain)` : ''}`);
                
                // Increment page counter for CAPTCHA monitoring
                this.pagesProcessed++;
                return result;

            } catch (error) {
                retryCount++;
                console.log(`⚠️ [P${this.processId}] Attempt ${retryCount} failed for employer ${employer.name}: ${error.message}`);
                
                // Check if this is a detached frame error
                if (error.message && error.message.includes('detached Frame')) {
                    console.log(`🚨 [P${this.processId}] Detected browser frame detachment - attempting to restart browser...`);
                    
                    const browserRestarted = await this.restartBrowser();
                    if (browserRestarted && retryCount <= this.maxRetries) {
                        console.log(`🔄 [P${this.processId}] Browser restarted, retrying employer ${employer.name}...`);
                        await this.delay(3000);
                        continue; // Retry with the new browser instance
                    } else if (!browserRestarted) {
                        console.error(`❌ [P${this.processId}] Failed to restart browser, cannot continue`);
                        throw new Error('Browser restart failed');
                    }
                }
                
                if (retryCount <= this.maxRetries) {
                    console.log(`🔄 [P${this.processId}] Retrying employer ${employer.name} in 5 seconds...`);
                    await this.delay(5000);
                } else {
                    console.log(`❌ [P${this.processId}] Max retries reached for employer ${employer.name}`);
                    return {
                        emails: [],
                        bestEmail: '',
                        website: '',
                        companyDomain: '',
                        domainEmailsFound: [],
                        portalDetection: null,
                        hasEmails: false,
                        hasWebsite: false,
                        hasDomainEmails: false,
                        isPortalWebsite: false,
                        success: false,
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
            console.log(`📸 [P${this.processId}] CAPTCHA image source:`, captchaSrc);

            // Solve CAPTCHA
            const solutionResult = await this.captchaSolver.solveCaptchaFromUrl(captchaSrc);
            const solution = solutionResult.success ? solutionResult.text : null;
            
            if (!solution) {
                console.log(`❌ [P${this.processId}] CAPTCHA solving failed`);
                return false;
            }

            // Find input field and submit button
            const inputSelector = 'input[name="captcha"], input[type="text"]';
            const submitSelector = 'button[type="submit"], input[type="submit"]';

            // Enter CAPTCHA solution
            await this.page.type(inputSelector, solution);
            console.log(`✏️ [P${this.processId}] CAPTCHA solution entered:`, solution);

            // Submit form
            await this.page.click(submitSelector);
            console.log(`📤 [P${this.processId}] CAPTCHA form submitted`);

            // Wait for submission to process and verify CAPTCHA is gone
            console.log(`⏳ [P${this.processId}] Waiting for CAPTCHA verification...`);
            
            // Wait up to 15 seconds for CAPTCHA to disappear
            let captchaGone = false;
            for (let i = 0; i < 15; i++) {
                await this.delay(1000); // Wait 1 second
                
                // Check if CAPTCHA is still present
                const stillHasCaptcha = await this.page.$(captchaImgSelector);
                if (!stillHasCaptcha) {
                    captchaGone = true;
                    console.log(`✅ [P${this.processId}] CAPTCHA disappeared after ${i + 1} seconds - solved successfully!`);
                    break;
                }
                
                console.log(`⌛ [P${this.processId}] Still waiting for CAPTCHA to disappear... (${i + 1}/15 seconds)`);
            }
            
            if (!captchaGone) {
                console.log(`❌ [P${this.processId}] CAPTCHA still present after 15 seconds - solution may be incorrect`);
                return false;
            }
            
            console.log(`✅ [P${this.processId}] CAPTCHA verification complete - proceeding to extract content`);
            return true;

        } catch (error) {
            console.log(`❌ [P${this.processId}] CAPTCHA solving error:`, error.message);
            return false;
        }
    }

    /**
     * Extract website URL from page
     */
    async extractWebsite() {
        try {
            // Look for application website link
            const websiteSelector = '#detail-bewerbung-url a, .bewerbung a, [href*="http"]';
            const websiteElement = await this.page.$(websiteSelector);
            
            if (websiteElement) {
                const website = await websiteElement.evaluate(el => el.href);
                if (website && website.startsWith('http')) {
                    return website;
                }
            }
            
            return '';
        } catch (error) {
            return '';
        }
    }

    /**
     * Save scraping results to employers table
     */
    async saveEmployerResults(employer, result) {
        const client = await this.pool.connect();
        try {
            const updateQuery = `
                UPDATE job_scrp_employers 
                SET 
                    email_extraction_attempted = true,
                    email_extraction_date = NOW(),
                    contact_emails = $1,
                    best_email = $2,
                    website = $3,
                    company_domain = $4,
                    has_emails = $5,
                    notes = $6,
                    last_updated = NOW()
                WHERE id = $7
            `;

            const notes = result.error ? `Error: ${result.error}` : 
                         result.hasEmails ? `Found ${result.emails.length} emails${result.hasDomainEmails ? ' (domain extraction)' : ''}` :
                         result.hasWebsite ? 'No emails, but found website' :
                         'No emails or website found';

            // Handle emails array or string
            const emailsString = Array.isArray(result.emails) ? result.emails.join(', ') : (result.emails || '');

            await client.query(updateQuery, [
                emailsString,
                result.bestEmail,
                result.website,
                result.companyDomain,
                result.hasEmails,
                notes,
                employer.id
            ]);

            console.log(`💾 [P${this.processId}] Results saved for employer: ${employer.name}`);

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
            console.log(`🧹 [P${this.processId}] Browser closed`);
        }
        
        // Clean up temporary user data directory
        if (this.userDataDir) {
            try {
                const fs = require('fs');
                fs.rmSync(this.userDataDir, { recursive: true, force: true });
                console.log(`🗑️ [P${this.processId}] Cleaned up user data directory: ${this.userDataDir}`);
            } catch (error) {
                console.log(`⚠️ [P${this.processId}] Could not clean up user data directory: ${error.message}`);
            }
        }
        
        await this.pool.end();
        console.log(`🧹 [P${this.processId}] Database connections closed`);
    }

    /**
     * Accept cookie consent if present
     */
    async acceptCookieConsent() {
        try {
            // Common cookie consent selectors for German websites
            const cookieSelectors = [
                // Arbeitsagentur specific
                'button[id*="cookie-accept"]',
                'button[class*="cookie-accept"]',
                'button[data-testid="cookie-accept"]',
                // Common German cookie consent patterns
                'button:has-text("Alle akzeptieren")',
                'button:has-text("Alle Cookies akzeptieren")',
                'button:has-text("Akzeptieren")',
                'button:has-text("Zustimmen")',
                'button:has-text("OK")',
                // Class-based selectors
                '.cookie-consent-accept',
                '.cookie-accept-all',
                '[class*="accept-all"]',
                '[class*="accept-cookies"]',
                // ID-based selectors
                '#accept-cookies',
                '#acceptAllCookies',
                // Data attribute selectors
                '[data-qa="accept-cookies"]',
                '[data-action="accept-cookies"]'
            ];
            
            // Try each selector
            for (const selector of cookieSelectors) {
                try {
                    const button = await this.page.$(selector);
                    if (button) {
                        const isVisible = await button.isIntersectingViewport();
                        if (isVisible) {
                            console.log(`🍪 [P${this.processId}] Found cookie consent button with selector: ${selector}`);
                            await button.click();
                            console.log(`✅ [P${this.processId}] Cookie consent accepted`);
                            await this.delay(1000); // Wait for cookie modal to disappear
                            return true;
                        }
                    }
                } catch (e) {
                    // Continue with next selector
                }
            }
            
            // Also try to find buttons by text content
            const acceptButton = await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const acceptButton = buttons.find(button => {
                    const text = button.textContent.toLowerCase().trim();
                    return text.includes('akzeptieren') || 
                           text.includes('zustimmen') || 
                           text.includes('alle cookies') ||
                           text === 'ok';
                });
                if (acceptButton && acceptButton.offsetParent !== null) {
                    acceptButton.click();
                    return true;
                }
                return false;
            });
            
            if (acceptButton) {
                console.log(`✅ [P${this.processId}] Cookie consent accepted via text search`);
                await this.delay(1000);
                return true;
            }
            
            return false;
        } catch (error) {
            console.log(`⚠️ [P${this.processId}] Error handling cookie consent: ${error.message}`);
            return false;
        }
    }

    /**
     * Restart browser when it becomes unresponsive or detached
     */
    async restartBrowser() {
        console.log(`🔄 [P${this.processId}] Restarting browser due to detached frame error...`);
        
        try {
            // Close existing browser if it exists
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (closeError) {
                    console.log(`⚠️ [P${this.processId}] Error closing browser: ${closeError.message}`);
                }
            }
            
            // Clean up old user data directory
            if (this.userDataDir) {
                try {
                    const fs = require('fs');
                    fs.rmSync(this.userDataDir, { recursive: true, force: true });
                } catch (cleanupError) {
                    console.log(`⚠️ [P${this.processId}] Could not clean up old user data: ${cleanupError.message}`);
                }
            }
            
            // Wait a moment before restarting
            await this.delay(2000);
            
            // Reinitialize browser
            await this.initializeBrowser();
            
            console.log(`✅ [P${this.processId}] Browser restarted successfully`);
            
            // Reset CAPTCHA tracking since we have a new session
            this.captchaCount = 0;
            this.lastCaptchaPage = 0;
            
            return true;
        } catch (error) {
            console.error(`❌ [P${this.processId}] Failed to restart browser: ${error.message}`);
            return false;
        }
    }

    /**
     * Utility delay function
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    const batchFile = process.argv[2];
    
    if (!batchFile) {
        console.error('❌ Usage: node batch-employer-scraper.js <batch-file.json>');
        process.exit(1);
    }
    
    if (!fs.existsSync(batchFile)) {
        console.error(`❌ Batch file not found: ${batchFile}`);
        process.exit(1);
    }
    
    const scraper = new BatchEmployerScraper();
    
    try {
        await scraper.initializeBrowser();
        await scraper.processBatchFile(batchFile);
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    } finally {
        await scraper.cleanup();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = BatchEmployerScraper;