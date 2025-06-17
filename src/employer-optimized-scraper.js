/**
 * Employer-Optimized Scraper
 * 
 * Strategy:
 * 1. Filter out jobs with external URLs (not scrapable)
 * 2. Group remaining jobs by employer
 * 3. Check if we already have emails for each employer
 * 4. Skip job_scrp_employers where we already have contact info
 * 5. For new job_scrp_employers, scrape just one representative job
 * 6. Apply extracted emails to ALL jobs from that employer
 */

const { Pool } = require('pg');
const JobDetailScraper = require('./job-detail-scraper');

const pool = new Pool({
    host: 'localhost',
    port: 5473,
    database: 'jetzt',
    user: 'odoo',
    password: 'odoo'
});

class EmployerOptimizedScraper {
    constructor() {
        this.detailScraper = new JobDetailScraper();
        this.stats = {
            totalEmployers: 0,
            employersWithExistingEmails: 0,
            employersToScrape: 0,
            employersScraped: 0,
            emailsFound: 0,
            jobsUpdated: 0,
            errors: 0,
            employersCreated: 0,
            duplicatesSkipped: 0
        };
    }

    /**
     * Create job_scrp_employers table and populate from existing job data
     */
    async createEmployersFromExistingData() {
        console.log('🏗️ Creating job_scrp_employers table from existing job data...');

        try {
            // Step 1: Create job_scrp_employers table if it doesn't exist
            await this.createEmployersTable();

            // Step 2: Extract and normalize employer data from jobs
            const employerData = await this.extractEmployerDataFromJobs();
            console.log(`📊 Found ${employerData.length} unique job_scrp_employers in job data`);

            // Step 3: Insert job_scrp_employers into table
            let created = 0;
            let skipped = 0;

            for (let i = 0; i < employerData.length; i++) {
                const employer = employerData[i];
                
                try {
                    const inserted = await this.insertEmployer(employer);
                    if (inserted) {
                        created++;
                    } else {
                        skipped++;
                    }
                } catch (error) {
                    console.error(`❌ Error inserting employer ${employer.name}:`, error.message);
                    skipped++;
                }

                // Progress indicator
                if ((i + 1) % 1000 === 0) {
                    console.log(`📈 Progress: ${i + 1}/${employerData.length} processed (${created} created, ${skipped} skipped)`);
                }
            }

            this.stats.employersCreated = created;
            this.stats.duplicatesSkipped = skipped;

            // Step 4: Update job records with employer IDs
            await this.linkJobsToEmployers();

            console.log('\n✅ Employer extraction completed!');
            console.log(`📊 Created: ${created} job_scrp_employers`);
            console.log(`⏭️ Skipped: ${skipped} duplicates`);

            return { created, skipped };

        } catch (error) {
            console.error('❌ Employer creation failed:', error);
            throw error;
        }
    }

    /**
     * Create job_scrp_employers table
     */
    async createEmployersTable() {
        const client = await pool.connect();
        try {
            // Drop existing job_scrp_employers table and recreate with our structure
            await client.query('DROP TABLE IF EXISTS job_scrp_employers CASCADE;');
            
            // Create table with our structure
            await client.query(`
                CREATE TABLE job_scrp_employers (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(500) NOT NULL,
                    normalized_name VARCHAR(500) NOT NULL UNIQUE,
                    job_count INTEGER DEFAULT 0,
                    scrapable_job_count INTEGER DEFAULT 0,
                    has_emails BOOLEAN DEFAULT FALSE,
                    contact_emails TEXT,
                    best_email VARCHAR(255),
                    company_domain VARCHAR(255),
                    website VARCHAR(500),
                    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    email_extraction_attempted BOOLEAN DEFAULT FALSE,
                    email_extraction_date TIMESTAMP,
                    notes TEXT
                );
            `);

            // Create indexes
            await client.query('CREATE INDEX idx_employers_normalized_name ON job_scrp_employers(normalized_name);');
            await client.query('CREATE INDEX idx_employers_has_emails ON job_scrp_employers(has_emails);');
            await client.query('CREATE INDEX idx_employers_domain ON job_scrp_employers(company_domain);');

            console.log('✅ Employers table created with new structure');
        } finally {
            client.release();
        }
    }

    /**
     * Extract unique employer data from existing jobs
     */
    async extractEmployerDataFromJobs() {
        const query = `
            SELECT 
                arbeitgeber as name,
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN (externeurl IS NULL OR externeurl = '') THEN 1 END) as scrapable_jobs,
                MIN(aktuelleVeroeffentlichungsdatum) as first_job_date,
                MAX(aktuelleVeroeffentlichungsdatum) as latest_job_date,
                MIN(refnr) as sample_refnr
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE arbeitgeber IS NOT NULL 
              AND arbeitgeber != ''
              AND TRIM(arbeitgeber) != ''
            GROUP BY arbeitgeber
            HAVING COUNT(*) >= 1
            ORDER BY total_jobs DESC
        `;

        const client = await pool.connect();
        try {
            const result = await client.query(query);
            return result.rows.map(row => ({
                name: row.name.trim(),
                normalizedName: this.normalizeEmployerName(row.name.trim()),
                jobCount: parseInt(row.total_jobs),
                scrapableJobCount: parseInt(row.scrapable_jobs),
                firstSeen: row.first_job_date,
                sampleRefnr: row.sample_refnr
            }));
        } finally {
            client.release();
        }
    }

    /**
     * Normalize employer name for deduplication
     */
    normalizeEmployerName(name) {
        return name
            .toLowerCase()
            .trim()
            // Remove common legal suffixes
            .replace(/\s+(gmbh|ag|kg|se|ug|ohg|gbr|e\.v\.|ev|mbh)(\s+&\s+co\.?\s*kg)?\.?\s*$/gi, '')
            .replace(/\s+&\s+co\.?\s*kg\.?\s*$/gi, '')
            .replace(/\s+stiftung\s*$/gi, '')
            .replace(/\s+dienstleistung(en)?\s*$/gi, '')
            .replace(/\s+verwaltung\s*$/gi, '')
            .replace(/\s+holding\s*$/gi, '')
            // Remove extra spaces
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Insert employer into database
     */
    async insertEmployer(employerData) {
        const insertQuery = `
            INSERT INTO job_scrp_employers (
                name, normalized_name, job_count, scrapable_job_count, first_seen
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (normalized_name) 
            DO UPDATE SET
                job_count = GREATEST(job_scrp_employers.job_count, EXCLUDED.job_count),
                scrapable_job_count = GREATEST(job_scrp_employers.scrapable_job_count, EXCLUDED.scrapable_job_count),
                last_updated = CURRENT_TIMESTAMP
            RETURNING id, (xmax = 0) as inserted
        `;

        const client = await pool.connect();
        try {
            const result = await client.query(insertQuery, [
                employerData.name,
                employerData.normalizedName,
                employerData.jobCount,
                employerData.scrapableJobCount,
                employerData.firstSeen
            ]);
            
            return result.rows[0].inserted; // true if inserted, false if updated
        } finally {
            client.release();
        }
    }

    /**
     * Link existing jobs to employer IDs
     */
    async linkJobsToEmployers() {
        console.log('🔗 Linking jobs to job_scrp_employers...');

        // Add employer_id column to job_scrp_arbeitsagentur_jobs_v2 if it doesn't exist
        const addColumnQuery = `
            ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 
            ADD COLUMN IF NOT EXISTS employer_id INTEGER REFERENCES job_scrp_employers(id);
            
            CREATE INDEX IF NOT EXISTS idx_jobs_employer_id ON job_scrp_arbeitsagentur_jobs_v2(employer_id);
        `;

        const updateQuery = `
            UPDATE job_scrp_arbeitsagentur_jobs_v2 
            SET employer_id = e.id
            FROM job_scrp_employers e
            WHERE job_scrp_arbeitsagentur_jobs_v2.employer_id IS NULL
              AND job_scrp_arbeitsagentur_jobs_v2.arbeitgeber IS NOT NULL
              AND e.normalized_name = $1
              AND job_scrp_arbeitsagentur_jobs_v2.arbeitgeber = $2
        `;

        const client = await pool.connect();
        try {
            // Add column
            await client.query(addColumnQuery);

            // Get all job_scrp_employers
            const employersResult = await client.query('SELECT id, name, normalized_name FROM job_scrp_employers');
            const job_scrp_employers = employersResult.rows;

            let linked = 0;
            for (let i = 0; i < job_scrp_employers.length; i++) {
                const employer = job_scrp_employers[i];
                
                const result = await client.query(updateQuery, [
                    employer.normalized_name,
                    employer.name
                ]);
                
                linked += result.rowCount;

                if ((i + 1) % 1000 === 0) {
                    console.log(`🔗 Linked ${linked} jobs to job_scrp_employers (${i + 1}/${job_scrp_employers.length} job_scrp_employers processed)`);
                }
            }

            console.log(`✅ Linked ${linked} jobs to job_scrp_employers`);
            return linked;

        } finally {
            client.release();
        }
    }

    /**
     * Run employer-optimized scraping
     * @param {number} maxEmployers - Maximum number of job_scrp_employers to process
     */
    async runOptimizedScraping(maxEmployers = 100) {
        console.log('🏢 Starting Employer-Optimized Scraping...');
        
        try {
            // Step 1: Get scrapable job_scrp_employers (no external URLs)
            const job_scrp_employers = await this.getScrapableEmployers(maxEmployers);
            console.log(`📊 Found ${job_scrp_employers.length} scrapable job_scrp_employers`);
            this.stats.totalEmployers = job_scrp_employers.length;

            // Step 2: Filter out job_scrp_employers we already have emails for
            const newEmployers = await this.filterEmployersWithoutEmails(job_scrp_employers);
            console.log(`🆕 ${newEmployers.length} job_scrp_employers need email extraction`);
            this.stats.employersWithExistingEmails = job_scrp_employers.length - newEmployers.length;
            this.stats.employersToScrape = newEmployers.length;

            // Step 3: Scrape emails for new job_scrp_employers
            for (let i = 0; i < newEmployers.length; i++) {
                const employer = newEmployers[i];
                console.log(`\n[${i + 1}/${newEmployers.length}] Processing employer: ${employer.arbeitgeber}`);
                console.log(`📋 ${employer.job_count} jobs from this employer`);
                
                try {
                    await this.processEmployer(employer);
                    this.stats.employersScraped++;
                } catch (error) {
                    console.error(`❌ Error processing ${employer.arbeitgeber}:`, error.message);
                    this.stats.errors++;
                }

                // Rate limiting between job_scrp_employers
                if (i < newEmployers.length - 1) {
                    await this.delay(3000);
                }
            }

            await this.printFinalStats();
            return this.stats;

        } catch (error) {
            console.error('❌ Employer-optimized scraping failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Get job_scrp_employers with scrapable jobs (no external URLs)
     */
    async getScrapableEmployers(limit = 100) {
        const query = `
            SELECT 
                arbeitgeber,
                COUNT(*) as job_count,
                MIN(refnr) as sample_refnr,
                MAX(aktuelleVeroeffentlichungsdatum) as latest_job_date
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE arbeitgeber IS NOT NULL 
              AND arbeitgeber != ''
              AND (externeurl IS NULL OR externeurl = '')
            GROUP BY arbeitgeber
            HAVING COUNT(*) >= 1  -- At least 1 job
            ORDER BY job_count DESC, latest_job_date DESC
            LIMIT $1
        `;

        const client = await pool.connect();
        try {
            const result = await client.query(query, [limit]);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Filter out job_scrp_employers we already have emails for
     */
    async filterEmployersWithoutEmails(job_scrp_employers) {
        const newEmployers = [];

        for (const employer of job_scrp_employers) {
            const hasEmails = await this.employerHasEmails(employer.arbeitgeber);
            if (!hasEmails) {
                newEmployers.push(employer);
            } else {
                console.log(`✅ Skip ${employer.arbeitgeber}: Already have emails`);
            }
        }

        return newEmployers;
    }

    /**
     * Check if employer already has emails extracted
     */
    async employerHasEmails(arbeitgeber) {
        const query = `
            SELECT COUNT(*) as email_count
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            JOIN job_scrp_job_details j ON a.refnr = j.reference_number
            WHERE a.arbeitgeber = $1 
              AND j.contact_emails IS NOT NULL 
              AND j.contact_emails != ''
        `;

        const client = await pool.connect();
        try {
            const result = await client.query(query, [arbeitgeber]);
            return parseInt(result.rows[0].email_count) > 0;
        } finally {
            client.release();
        }
    }

    /**
     * Process a single employer
     */
    async processEmployer(employer) {
        const { arbeitgeber, sample_refnr, job_count } = employer;

        // Step 1: Scrape email from one representative job
        console.log(`🔍 Scraping sample job: ${sample_refnr}`);
        const details = await this.detailScraper.scrapeJobDetails(sample_refnr);

        if (details.error) {
            console.log(`❌ Scraping failed: ${details.error}`);
            return;
        }

        // Step 2: Extract emails
        const emails = this.extractEmailsFromDetails(details);
        
        if (emails.length === 0) {
            console.log(`📭 No emails found for ${arbeitgeber}`);
            return;
        }

        console.log(`📧 Found emails: ${emails.join(', ')}`);
        this.stats.emailsFound += emails.length;

        // Step 3: Apply emails to ALL jobs from this employer
        const updatedJobs = await this.applyEmailsToEmployerJobs(arbeitgeber, emails, details);
        console.log(`✅ Applied emails to ${updatedJobs} jobs from ${arbeitgeber}`);
        this.stats.jobsUpdated += updatedJobs;
    }

    /**
     * Extract emails from job details
     */
    extractEmailsFromDetails(details) {
        const emails = [];
        
        if (details.contact && details.contact.email) {
            emails.push(details.contact.email);
        }
        
        if (details.application && details.application.email) {
            emails.push(details.application.email);
        }

        // Remove duplicates and invalid emails
        return [...new Set(emails)].filter(email => 
            email && email.includes('@') && email.includes('.')
        );
    }

    /**
     * Apply extracted emails to all jobs from this employer
     */
    async applyEmailsToEmployerJobs(arbeitgeber, emails, sampleDetails) {
        const contactEmails = emails.join(', ');
        const bestEmail = emails[0];
        const domain = bestEmail.split('@')[1];

        const updateQuery = `
            INSERT INTO job_scrp_job_details (
                reference_number, arbeitsagentur_job_id, contact_emails, best_email, 
                company_domain, has_emails, email_count, scraped_at, 
                scraping_success, email_source
            )
            SELECT 
                a.refnr,
                a.id,
                $2 as contact_emails,
                $3 as best_email,
                $4 as company_domain,
                true as has_emails,
                $5 as email_count,
                CURRENT_TIMESTAMP as scraped_at,
                true as scraping_success,
                'employer_optimization' as email_source
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            WHERE a.arbeitgeber = $1
              AND (a.externeurl IS NULL OR a.externeurl = '')
            ON CONFLICT (reference_number) 
            DO UPDATE SET
                contact_emails = EXCLUDED.contact_emails,
                best_email = EXCLUDED.best_email,
                company_domain = EXCLUDED.company_domain,
                has_emails = EXCLUDED.has_emails,
                email_count = EXCLUDED.email_count,
                updated_at = CURRENT_TIMESTAMP,
                email_source = EXCLUDED.email_source
            WHERE job_scrp_job_details.contact_emails IS NULL OR job_scrp_job_details.contact_emails = ''
        `;

        const client = await pool.connect();
        try {
            const result = await client.query(updateQuery, [
                arbeitgeber, contactEmails, bestEmail, domain, emails.length
            ]);
            return result.rowCount;
        } finally {
            client.release();
        }
    }

    /**
     * Print final statistics
     */
    async printFinalStats() {
        console.log('\n' + '='.repeat(60));
        console.log('🏢 EMPLOYER-OPTIMIZED SCRAPING RESULTS');
        console.log('='.repeat(60));
        console.log(`📊 Total job_scrp_employers analyzed: ${this.stats.totalEmployers}`);
        console.log(`✅ Employers with existing emails: ${this.stats.employersWithExistingEmails}`);
        console.log(`🆕 Employers needing emails: ${this.stats.employersToScrape}`);
        console.log(`🔍 Employers scraped: ${this.stats.employersScraped}`);
        console.log(`📧 Total emails found: ${this.stats.emailsFound}`);
        console.log(`📋 Jobs updated with emails: ${this.stats.jobsUpdated}`);
        console.log(`❌ Errors: ${this.stats.errors}`);
        
        if (this.stats.employersScraped > 0) {
            const successRate = (this.stats.employersScraped / this.stats.employersToScrape * 100).toFixed(1);
            const averageJobsPerEmployer = (this.stats.jobsUpdated / this.stats.employersScraped).toFixed(1);
            console.log(`📈 Success rate: ${successRate}%`);
            console.log(`📊 Average jobs per employer: ${averageJobsPerEmployer}`);
        }
        console.log('='.repeat(60));
    }

    /**
     * Delay helper
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.detailScraper) {
            await this.detailScraper.cleanup();
        }
        await pool.end();
    }
}

module.exports = EmployerOptimizedScraper;