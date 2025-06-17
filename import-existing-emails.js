/**
 * Import emails from our_sql_employment_agency table to current job system
 * and update job_scrp_employers with email information
 */

const { Client } = require('pg');

const client = new Client({
    host: 'localhost',
    port: 5473,
    database: 'jetzt',
    user: 'odoo',
    password: 'odoo'
});

async function importExistingEmails() {
    console.log('📧 Importing emails from our_sql_employment_agency...');

    try {
        await client.connect();

        // Step 1: Check what data we have in our_sql_employment_agency
        console.log('🔍 Analyzing our_sql_employment_agency table...');
        const analysisResult = await client.query(`
            SELECT 
                COUNT(*) as total_records,
                COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as records_with_email,
                COUNT(DISTINCT email) as unique_emails,
                COUNT(DISTINCT reference_number) as unique_refs
            FROM our_sql_employment_agency
            WHERE email IS NOT NULL AND email != ''
        `);

        const analysis = analysisResult.rows[0];
        console.log(`📊 Analysis results:`);
        console.log(`   Total records with emails: ${analysis.records_with_email}`);
        console.log(`   Unique emails: ${analysis.unique_emails}`);
        console.log(`   Unique reference numbers: ${analysis.unique_refs}`);

        // Step 2: Get sample data to understand structure
        console.log('\n📋 Sample data from our_sql_employment_agency:');
        const sampleResult = await client.query(`
            SELECT reference_number, email, employer
            FROM our_sql_employment_agency 
            WHERE email IS NOT NULL AND email != '' 
            LIMIT 10
        `);
        
        sampleResult.rows.forEach((row, i) => {
            console.log(`   ${i+1}. ${row.reference_number} -> ${row.email} (${row.employer})`);
        });

        // Step 3: Import emails into job_scrp_job_details table
        console.log('\n🔄 Importing emails into job_scrp_job_details...');
        const importResult = await client.query(`
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
                email_source
            )
            SELECT 
                o.reference_number,
                a.id as arbeitsagentur_job_id,
                o.email as contact_emails,
                o.email as best_email,
                SPLIT_PART(o.email, '@', 2) as company_domain,
                true as has_emails,
                1 as email_count,
                CURRENT_TIMESTAMP as scraped_at,
                true as scraping_success,
                'our_sql_employment_agency' as email_source
            FROM our_sql_employment_agency o
            JOIN job_scrp_arbeitsagentur_jobs_v2 a ON o.reference_number = a.refnr
            WHERE o.email IS NOT NULL 
              AND o.email != ''
              AND o.email != 'keine'  -- Filter out 'keine' (none)
              AND o.email LIKE '%@%.%'  -- Basic email validation
              AND LENGTH(o.email) <= 255  -- Respect varchar limit
            ON CONFLICT (reference_number) 
            DO UPDATE SET
                contact_emails = COALESCE(job_scrp_job_details.contact_emails, EXCLUDED.contact_emails),
                best_email = COALESCE(job_scrp_job_details.best_email, EXCLUDED.best_email),
                company_domain = COALESCE(job_scrp_job_details.company_domain, EXCLUDED.company_domain),
                has_emails = true,
                email_count = GREATEST(job_scrp_job_details.email_count, EXCLUDED.email_count),
                updated_at = CURRENT_TIMESTAMP,
                email_source = CASE 
                    WHEN job_scrp_job_details.email_source IS NULL THEN EXCLUDED.email_source
                    ELSE job_scrp_job_details.email_source || ', ' || EXCLUDED.email_source
                END
            WHERE job_scrp_job_details.contact_emails IS NULL OR job_scrp_job_details.contact_emails = ''
        `);

        console.log(`✅ Imported ${importResult.rowCount} emails into job_scrp_job_details`);

        // Step 4: Update job_scrp_employers with email information
        console.log('\n🏢 Updating job_scrp_employers with email information...');
        
        // First, get job_scrp_employers that now have emails
        const employerEmailsResult = await client.query(`
            SELECT 
                e.id as employer_id,
                e.name as employer_name,
                e.normalized_name,
                STRING_AGG(DISTINCT jd.contact_emails, ', ') as all_emails,
                MIN(jd.contact_emails) as best_email,
                MIN(jd.company_domain) as domain,
                COUNT(jd.contact_emails) as email_jobs_count
            FROM job_scrp_employers e
            JOIN job_scrp_arbeitsagentur_jobs_v2 a ON a.employer_id = e.id
            JOIN job_scrp_job_details jd ON jd.reference_number = a.refnr
            WHERE jd.contact_emails IS NOT NULL 
              AND jd.contact_emails != ''
            GROUP BY e.id, e.name, e.normalized_name
        `);

        console.log(`📊 Found ${employerEmailsResult.rows.length} job_scrp_employers with emails`);

        // Update job_scrp_employers table
        let updatedEmployers = 0;
        for (const employer of employerEmailsResult.rows) {
            // Limit field lengths to avoid varchar overflow
            const allEmails = employer.all_emails ? employer.all_emails.substring(0, 500) : null;
            const bestEmail = employer.best_email ? employer.best_email.substring(0, 255) : null;
            const domain = employer.domain ? employer.domain.substring(0, 255) : null;
            
            const updateResult = await client.query(`
                UPDATE job_scrp_employers 
                SET 
                    has_emails = true,
                    contact_emails = $1,
                    best_email = $2,
                    company_domain = $3,
                    email_extraction_attempted = true,
                    email_extraction_date = CURRENT_TIMESTAMP,
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = $4
            `, [
                allEmails,
                bestEmail,
                domain,
                employer.employer_id
            ]);

            if (updateResult.rowCount > 0) {
                updatedEmployers++;
            }
        }

        console.log(`✅ Updated ${updatedEmployers} job_scrp_employers with email information`);

        // Step 5: Apply emails to all jobs from the same employer
        console.log('\n🔄 Applying emails to all jobs from job_scrp_employers with known emails...');
        
        const applyEmailsResult = await client.query(`
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
                email_source
            )
            SELECT 
                a.refnr as reference_number,
                a.id as arbeitsagentur_job_id,
                e.contact_emails,
                e.best_email,
                e.company_domain,
                true as has_emails,
                1 as email_count,
                CURRENT_TIMESTAMP as scraped_at,
                true as scraping_success,
                'employer_propagation' as email_source
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            JOIN job_scrp_employers e ON a.employer_id = e.id
            WHERE e.has_emails = true
              AND (a.externeurl IS NULL OR a.externeurl = '')  -- Only scrapable jobs
            ON CONFLICT (reference_number) 
            DO UPDATE SET
                contact_emails = COALESCE(job_scrp_job_details.contact_emails, EXCLUDED.contact_emails),
                best_email = COALESCE(job_scrp_job_details.best_email, EXCLUDED.best_email),
                company_domain = COALESCE(job_scrp_job_details.company_domain, EXCLUDED.company_domain),
                has_emails = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_scrp_job_details.contact_emails IS NULL OR job_scrp_job_details.contact_emails = ''
        `);

        console.log(`✅ Applied emails to ${applyEmailsResult.rowCount} additional jobs`);

        // Step 6: Final statistics
        console.log('\n📊 Final statistics...');
        const finalStats = await client.query(`
            SELECT 
                COUNT(*) as total_job_details,
                COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as jobs_with_emails,
                COUNT(DISTINCT company_domain) as unique_domains,
                COUNT(DISTINCT best_email) as unique_emails
            FROM job_scrp_job_details
        `);

        const employerStats = await client.query(`
            SELECT 
                COUNT(*) as total_employers,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as employers_with_emails
            FROM job_scrp_employers
        `);

        const stats = finalStats.rows[0];
        const empStats = employerStats.rows[0];

        console.log('\n' + '='.repeat(60));
        console.log('✅ EMAIL IMPORT COMPLETED');
        console.log('='.repeat(60));
        console.log(`📋 Total job details: ${stats.total_job_details}`);
        console.log(`📧 Jobs with emails: ${stats.jobs_with_emails}`);
        console.log(`🏢 Total job_scrp_employers: ${empStats.total_employers}`);
        console.log(`📧 Employers with emails: ${empStats.employers_with_emails}`);
        console.log(`🌐 Unique domains: ${stats.unique_domains}`);
        console.log(`📬 Unique email addresses: ${stats.unique_emails}`);
        
        const emailCoverage = (parseInt(stats.jobs_with_emails) / parseInt(stats.total_job_details) * 100).toFixed(2);
        const employerCoverage = (parseInt(empStats.employers_with_emails) / parseInt(empStats.total_employers) * 100).toFixed(2);
        
        console.log(`📈 Job email coverage: ${emailCoverage}%`);
        console.log(`📈 Employer email coverage: ${employerCoverage}%`);
        console.log('='.repeat(60));

        return {
            jobsWithEmails: parseInt(stats.jobs_with_emails),
            employersWithEmails: parseInt(empStats.employers_with_emails),
            uniqueDomains: parseInt(stats.unique_domains),
            uniqueEmails: parseInt(stats.unique_emails)
        };

    } catch (error) {
        console.error('❌ Email import failed:', error);
        throw error;
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    importExistingEmails()
        .then(result => {
            console.log('🎉 Email import completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Email import failed:', error);
            process.exit(1);
        });
}

module.exports = importExistingEmails;