const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const ProductionEmailExtractor = require('./src/production-email-extractor');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const dbConfig = config.production;

// Recent job reference numbers to scrape (newest first)
const jobRefNumbers = [
    "19493-7068685-S",
    "19159-s9t7t0xuv0-S", 
    "19155-b8a070cc_JB4794197-S",
    "19149-k11134.1583-S",
    "19049-p1inmmwr4h-S",
    "19037-0053339494-S",
    "18896-8442098-S",
    "18896-8441592-S",
    "18681-43433130-64-S",
    "18662-k60144.1136-S",
    "18651-00003c0c429001-S",
    "18444-0053335849-S",
    "18442-43431901-64-S",
    "18374-9ZqVMGl0-S",
    "18251-21950-S",
    "18029-0056767363-S",
    "18026-0053345999-S",
    "17839-2025-10350020-S",
    "17792-43431977-64-S",
    "17751-43433775-64-S",
    "17751-43433040-64-S",
    "17751-43431805-64-S",
    "17717-f00f3b918279440-S",
    "17717-99c5cedc0f004d5-S",
    "17717-7eb03abf5e67487-S",
    "17710-0056770908-S",
    "17710-0055939342-S",
    "17700-0056771548-S",
    "17651-43432035-64-S",
    "17651-43431719-64-S",
    "17560-4d849544a2b040b-S",
    "17402-43431169-64-S",
    "17309-61e28c76523f4d5-S",
    "17163-0053323534-S",
    "17102-43432452-64-S",
    "16915-SXWQ1NRMFP83V28W-S",
    "16856-0053318669-S",
    "16785-k58609.6751-S",
    "16572-43431744-64-S",
    "16569-0056773038-S",
    "16545-43428674-63-S",
    "16506-0055941352-S",
    "16486-YUPQCCCBWolyqo-S",
    "16470-43432889-64-S",
    "16463-2025a6ys2fq6-000-S",
    "16444-20251880-S",
    "16324-0056771958-S",
    "16315-273be364a6faf61f-S",
    "16314-4EVEZLMCNCUE4YPW-S",
    "16291-087702bfaacf43f-S"
];

class SpecificJobScraper {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.emailExtractor = new ProductionEmailExtractor();
        this.browser = null;
        this.page = null;
        this.results = {
            total: 0,
            found: 0,
            notFound: 0,
            errors: 0
        };
    }

    async initializeBrowser() {
        console.log('🚀 Initializing browser...');
        
        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('✅ Browser initialized');
    }

    constructDetailUrl(refnr) {
        return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
    }

    async scrapeJob(refnr) {
        const startTime = Date.now();
        let result = {
            refnr,
            success: false,
            emails: '',
            bestEmail: '',
            domain: '',
            emailCount: 0,
            notFound: false,
            error: null,
            duration: 0
        };

        try {
            const detailUrl = this.constructDetailUrl(refnr);
            console.log(`🔍 Scraping: ${refnr}`);
            console.log(`🔗 URL: ${detailUrl}`);

            // Navigate to detail page
            await this.page.goto(detailUrl, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });

            // Wait a bit for page to fully load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check if job doesn't exist
            const html = await this.page.content();
            if (html.includes('Dieses Stellenangebot gibt es nicht oder nicht mehr.')) {
                console.log('❌ Job no longer exists - skipping');
                result.notFound = true;
                this.results.notFound++;
                return result;
            }

            // Extract emails using our efficient email extractor
            const emailResult = this.emailExtractor.extractEmails(html);

            result = {
                ...result,
                success: true,
                emails: emailResult.emails,
                bestEmail: emailResult.bestEmail || '',
                domain: emailResult.domain || '',
                emailCount: emailResult.emailCount
            };

            console.log(`✅ Found ${emailResult.emailCount} emails: ${emailResult.emails}`);
            if (emailResult.bestEmail) {
                console.log(`🎯 Best email: ${emailResult.bestEmail}`);
                this.results.found++;
            }

            // Save to database
            await this.saveJobDetails(result);

        } catch (error) {
            console.error(`❌ Error scraping ${refnr}:`, error.message);
            result.error = error.message;
            this.results.errors++;
        }

        result.duration = Date.now() - startTime;
        this.results.total++;
        return result;
    }

    async saveJobDetails(result) {
        const query = `
            INSERT INTO job_scrp_job_details (
                reference_number, contact_emails, best_email, company_domain,
                has_emails, email_count, scraped_at, scraping_duration_ms,
                scraping_success, scraping_error, source_url, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, NOW(), NOW())
            ON CONFLICT (reference_number) DO UPDATE SET
                contact_emails = EXCLUDED.contact_emails,
                best_email = EXCLUDED.best_email,
                company_domain = EXCLUDED.company_domain,
                has_emails = EXCLUDED.has_emails,
                email_count = EXCLUDED.email_count,
                scraped_at = EXCLUDED.scraped_at,
                scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                scraping_success = EXCLUDED.scraping_success,
                scraping_error = EXCLUDED.scraping_error,
                updated_at = NOW()
        `;

        const values = [
            result.refnr,
            result.emails,
            result.bestEmail,
            result.domain,
            result.emailCount > 0,
            result.emailCount,
            result.duration,
            result.success,
            result.error,
            this.constructDetailUrl(result.refnr)
        ];

        const client = await this.pool.connect();
        try {
            await client.query(query, values);
            console.log(`💾 Saved results for ${result.refnr}`);
        } finally {
            client.release();
        }
    }

    async run() {
        try {
            await this.initializeBrowser();
            
            console.log(`📋 Starting to scrape ${jobRefNumbers.length} specific jobs...`);

            for (const refnr of jobRefNumbers) {
                await this.scrapeJob(refnr);
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('\n📊 Final Results:');
            console.log(`Total processed: ${this.results.total}`);
            console.log(`Jobs with emails: ${this.results.found}`);
            console.log(`Jobs not found: ${this.results.notFound}`);
            console.log(`Errors: ${this.results.errors}`);

        } catch (error) {
            console.error('❌ Scraper error:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
            await this.pool.end();
        }
    }
}

// Run the scraper
const scraper = new SpecificJobScraper();
scraper.run().catch(console.error);