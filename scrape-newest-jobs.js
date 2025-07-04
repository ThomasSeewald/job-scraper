/**
 * Scrape newest jobs starting from highest ID and working backwards
 */

const { Client } = require('pg');
const JobDetailScraper = require('./src/job-detail-scraper');

const client = new Client({
    host: 'localhost',
    port: 5473,
    database: 'jetzt',
    user: 'odoo',
    password: 'odoo'
});

async function scrapeNewestJobs(maxJobs = 50) {
    console.log('🆕 Starting newest jobs scraper...');
    console.log(`🎯 Target: ${maxJobs} unscraped jobs from highest IDs`);
    
    const scraper = new JobDetailScraper();
    let scraped = 0;
    let found = 0;
    let errors = 0;
    
    try {
        await client.connect();
        
        // Get unscraped jobs starting from highest ID
        const query = `
            SELECT 
                a.refnr,
                a.id,
                a.arbeitgeber,
                a.titel
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            LEFT JOIN job_scrp_job_details jd ON a.refnr = jd.reference_number
            WHERE (a.externeurl IS NULL OR a.externeurl = '')  -- Only scrapable jobs
              AND a.arbeitgeber IS NOT NULL
              AND jd.reference_number IS NULL  -- Not yet scraped
              AND a.arbeitgeber NOT LIKE '%@arbeitsagentur.de%'  -- Exclude BA emails
            ORDER BY a.id DESC
            LIMIT $1
        `;
        
        const result = await client.query(query, [maxJobs * 2]); // Get extra in case some fail
        const jobs = result.rows;
        
        console.log(`📋 Found ${jobs.length} unscraped jobs to process`);
        console.log('🚀 Starting scraping...\n');
        
        for (let i = 0; i < jobs.length && scraped < maxJobs; i++) {
            const job = jobs[i];
            const progress = `[${i + 1}/${Math.min(jobs.length, maxJobs)}]`;
            
            console.log(`${progress} Processing: ${job.refnr}`);
            console.log(`📋 ${job.arbeitgeber} - ${job.titel.substring(0, 60)}...`);
            
            try {
                // Scrape job details
                const startTime = Date.now();
                const details = await scraper.scrapeJobDetails(job.refnr);
                const duration = Date.now() - startTime;
                
                if (details.error) {
                    console.log(`❌ Scraping failed: ${details.error}`);
                    errors++;
                } else {
                    // Extract emails
                    const emails = extractEmails(details);
                    const hasEmails = emails.length > 0;
                    
                    // Store in database
                    await storeJobDetails(job.refnr, details, emails, duration);
                    
                    if (hasEmails) {
                        found++;
                        console.log(`✅ EMAILS FOUND: ${emails.join(', ')}`);
                    } else {
                        console.log(`📭 No emails found`);
                    }
                    
                    scraped++;
                    console.log(`⏱️  Duration: ${duration}ms | 📧 Found: ${found}/${scraped} (${(found/scraped*100).toFixed(1)}%)\n`);
                }
                
                // Rate limiting
                await delay(2000);
                
            } catch (error) {
                console.error(`❌ Error processing ${job.refnr}:`, error.message);
                errors++;
            }
        }
        
        // Final statistics
        console.log('=' .repeat(60));
        console.log('🏁 SCRAPING COMPLETED');
        console.log('=' .repeat(60));
        console.log(`📊 Jobs processed: ${scraped}`);
        console.log(`📧 Emails found: ${found}`);
        console.log(`📈 Success rate: ${(found/scraped*100).toFixed(1)}%`);
        console.log(`❌ Errors: ${errors}`);
        console.log('=' .repeat(60));
        
    } catch (error) {
        console.error('❌ Scraping failed:', error);
    } finally {
        await scraper.cleanup();
        await client.end();
    }
}

function extractEmails(details) {
    const emails = [];
    
    if (details.contact && details.contact.email) {
        emails.push(details.contact.email);
    }
    
    if (details.application && details.application.email) {
        emails.push(details.application.email);
    }
    
    // Remove duplicates and invalid emails
    return [...new Set(emails)].filter(email => 
        email && 
        email.includes('@') && 
        email.includes('.') &&
        !email.includes('@arbeitsagentur.de')
    );
}

async function storeJobDetails(refnr, details, emails, duration) {
    const hasEmails = emails.length > 0;
    const bestEmail = hasEmails ? emails[0] : null;
    const domain = bestEmail ? bestEmail.split('@')[1] : null;
    
    // Get arbeitsagentur_job_id
    const jobQuery = 'SELECT id FROM job_scrp_arbeitsagentur_jobs_v2 WHERE refnr = $1';
    const jobResult = await client.query(jobQuery, [refnr]);
    const arbeitsagenturJobId = jobResult.rows.length > 0 ? jobResult.rows[0].id : null;
    
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
            scraping_success, 
            email_source,
            scraping_duration_ms
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10
        )
        ON CONFLICT (reference_number) 
        DO UPDATE SET
            contact_emails = EXCLUDED.contact_emails,
            best_email = EXCLUDED.best_email,
            company_domain = EXCLUDED.company_domain,
            has_emails = EXCLUDED.has_emails,
            email_count = EXCLUDED.email_count,
            updated_at = CURRENT_TIMESTAMP,
            email_source = EXCLUDED.email_source,
            scraping_duration_ms = EXCLUDED.scraping_duration_ms
    `;
    
    await client.query(insertQuery, [
        refnr,
        arbeitsagenturJobId,
        hasEmails ? emails.join(', ') : null,
        bestEmail,
        domain,
        hasEmails,
        emails.length,
        true, // scraping_success
        'fresh_scraping',
        duration
    ]);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run if called directly
if (require.main === module) {
    const maxJobs = process.argv[2] ? parseInt(process.argv[2]) : 50;
    scrapeNewestJobs(maxJobs)
        .then(() => {
            console.log('🎉 Fresh scraping completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Fresh scraping failed:', error);
            process.exit(1);
        });
}

module.exports = scrapeNewestJobs;