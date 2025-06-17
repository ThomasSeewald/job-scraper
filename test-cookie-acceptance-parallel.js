const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class TestWorker {
    constructor(workerId = 1) {
        this.workerId = workerId;
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log(`[Worker ${this.workerId}] Initializing browser...`);
        this.browser = await puppeteer.launch({
            headless: false, // Visible for testing
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setDefaultTimeout(30000);
        console.log(`[Worker ${this.workerId}] Browser ready`);
    }

    async acceptCookies() {
        try {
            console.log(`[Worker ${this.workerId}] Checking for cookie modal...`);
            
            // Wait for either the cookie button or page content
            await this.page.waitForSelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"], body', {
                timeout: 10000
            });

            // Check if cookie button exists
            const cookieButton = await this.page.$('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
            
            if (cookieButton) {
                console.log(`[Worker ${this.workerId}] Cookie modal found, accepting cookies...`);
                
                // Click the cookie accept button
                await this.page.click('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                
                // Wait a bit for the modal to disappear
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

    async visitDomain(domain) {
        const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
        
        try {
            console.log(`[Worker ${this.workerId}] Visiting: ${baseUrl}`);
            await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            
            // Always check for cookies after navigation
            await this.acceptCookies();
            
            // Now continue with regular processing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Get page title as a test
            const title = await this.page.title();
            console.log(`[Worker ${this.workerId}] Page title: ${title}`);
            
            // Look for email addresses on the page
            const pageText = await this.page.evaluate(() => document.body.textContent || '');
            const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emails = pageText.match(emailPattern) || [];
            
            console.log(`[Worker ${this.workerId}] Found ${emails.length} emails on homepage`);
            
            return { success: true, emails: emails.length };
            
        } catch (error) {
            console.log(`[Worker ${this.workerId}] Error visiting ${baseUrl}: ${error.message}`);
            return { success: false, emails: 0 };
        }
    }

    async testSingleDomain() {
        try {
            await this.init();
            
            // Get a test domain from the database
            const result = await pool.query(`
                SELECT domain 
                FROM job_scrp_domain_analysis 
                WHERE domain IS NOT NULL 
                AND domain <> ''
                AND (email_extraction_attempted IS NULL OR email_extraction_attempted = false)
                ORDER BY frequency DESC
                LIMIT 1
            `);
            
            if (result.rows.length === 0) {
                console.log('No unprocessed domains found');
                return;
            }
            
            const testDomain = result.rows[0].domain;
            console.log(`\nTesting with domain: ${testDomain}`);
            
            // Visit the domain
            const result1 = await this.visitDomain(testDomain);
            console.log(`First visit result:`, result1);
            
            // Test browser restart scenario
            console.log(`\n[Worker ${this.workerId}] Simulating browser restart...`);
            await this.browser.close();
            await this.init();
            
            // Visit another domain after restart
            const result2 = await pool.query(`
                SELECT domain 
                FROM job_scrp_domain_analysis 
                WHERE domain IS NOT NULL 
                AND domain <> ''
                AND domain != $1
                AND (email_extraction_attempted IS NULL OR email_extraction_attempted = false)
                ORDER BY frequency DESC
                LIMIT 1
            `, [testDomain]);
            
            if (result2.rows.length > 0) {
                const secondDomain = result2.rows[0].domain;
                console.log(`\nTesting after restart with domain: ${secondDomain}`);
                const visitResult = await this.visitDomain(secondDomain);
                console.log(`Second visit result:`, visitResult);
            }
            
        } catch (error) {
            console.error('Test failed:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
            await pool.end();
        }
    }
}

// Run the test
if (require.main === module) {
    const worker = new TestWorker();
    worker.testSingleDomain().catch(console.error);
}