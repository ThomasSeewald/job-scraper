/**
 * Complete the employer linking process for all jobs
 * This will link the remaining 290,134 jobs to their job_scrp_employers
 */

const { Client } = require('pg');

const client = new Client({
    host: 'localhost',
    port: 5473,
    database: 'jetzt',
    user: 'odoo',
    password: 'odoo'
});

async function completeEmployerLinking() {
    console.log('🔗 Completing employer linking for all jobs...');

    try {
        await client.connect();

        // Step 1: Check current status
        console.log('📊 Checking current linking status...');
        const statusResult = await client.query(`
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN employer_id IS NOT NULL THEN 1 END) as jobs_with_employer_id,
                COUNT(CASE WHEN employer_id IS NULL THEN 1 END) as jobs_missing_employer_id
            FROM job_scrp_arbeitsagentur_jobs_v2
        `);

        const status = statusResult.rows[0];
        console.log(`📋 Total jobs: ${status.total_jobs}`);
        console.log(`✅ Jobs with employer_id: ${status.jobs_with_employer_id}`);
        console.log(`❌ Jobs missing employer_id: ${status.jobs_missing_employer_id}`);

        if (parseInt(status.jobs_missing_employer_id) === 0) {
            console.log('✅ All jobs are already linked to job_scrp_employers!');
            return;
        }

        // Step 2: Link jobs to job_scrp_employers using normalized names
        console.log('\n🔄 Linking remaining jobs to job_scrp_employers...');
        
        // Use a more efficient approach - batch update by employer
        const updateResult = await client.query(`
            UPDATE job_scrp_arbeitsagentur_jobs_v2 
            SET employer_id = e.id
            FROM job_scrp_employers e
            WHERE job_scrp_arbeitsagentur_jobs_v2.employer_id IS NULL
              AND job_scrp_arbeitsagentur_jobs_v2.arbeitgeber IS NOT NULL
              AND LOWER(TRIM(REGEXP_REPLACE(
                  REGEXP_REPLACE(
                      REGEXP_REPLACE(job_scrp_arbeitsagentur_jobs_v2.arbeitgeber, 
                          '\\s+(gmbh|ag|kg|se|ug|ohg|gbr|e\\.v\\.|ev|mbh)(\\s+&\\s+co\\.?\\s*kg)?\\.?\\s*$', '', 'gi'),
                      '\\s+&\\s+co\\.?\\s*kg\\.?\\s*$', '', 'gi'),
                  '\\s+(stiftung|dienstleistung(en)?|verwaltung|holding)\\s*$', '', 'gi')
              )) = e.normalized_name
        `);

        console.log(`✅ Linked ${updateResult.rowCount} additional jobs to job_scrp_employers`);

        // Step 3: Check final status
        console.log('\n📊 Checking final linking status...');
        const finalStatusResult = await client.query(`
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN employer_id IS NOT NULL THEN 1 END) as jobs_with_employer_id,
                COUNT(CASE WHEN employer_id IS NULL THEN 1 END) as jobs_still_missing_employer_id
            FROM job_scrp_arbeitsagentur_jobs_v2
        `);

        const finalStatus = finalStatusResult.rows[0];
        console.log(`📋 Total jobs: ${finalStatus.total_jobs}`);
        console.log(`✅ Jobs with employer_id: ${finalStatus.jobs_with_employer_id}`);
        console.log(`❌ Jobs still missing employer_id: ${finalStatus.jobs_still_missing_employer_id}`);

        const linkingRate = (parseInt(finalStatus.jobs_with_employer_id) / parseInt(finalStatus.total_jobs) * 100).toFixed(2);
        console.log(`📈 Employer linking rate: ${linkingRate}%`);

        // Step 4: Re-run email propagation with the newly linked jobs
        console.log('\n🔄 Re-running email propagation for newly linked job_scrp_employers...');
        
        const emailPropagationResult = await client.query(`
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
                'employer_propagation_v2' as email_source
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            JOIN job_scrp_employers e ON a.employer_id = e.id
            WHERE e.has_emails = true
              AND e.contact_emails IS NOT NULL
              AND e.contact_emails != ''
              AND (a.externeurl IS NULL OR a.externeurl = '')  -- Only scrapable jobs
            ON CONFLICT (reference_number) 
            DO UPDATE SET
                contact_emails = COALESCE(job_scrp_job_details.contact_emails, EXCLUDED.contact_emails),
                best_email = COALESCE(job_scrp_job_details.best_email, EXCLUDED.best_email),
                company_domain = COALESCE(job_scrp_job_details.company_domain, EXCLUDED.company_domain),
                has_emails = true,
                updated_at = CURRENT_TIMESTAMP,
                email_source = CASE 
                    WHEN job_scrp_job_details.email_source IS NULL THEN EXCLUDED.email_source
                    ELSE job_scrp_job_details.email_source
                END
            WHERE job_scrp_job_details.contact_emails IS NULL OR job_scrp_job_details.contact_emails = ''
        `);

        console.log(`✅ Applied emails to ${emailPropagationResult.rowCount} additional jobs through employer linking`);

        // Step 5: Update employer statistics
        console.log('\n🔄 Updating employer email statistics...');
        
        const employerUpdateResult = await client.query(`
            UPDATE job_scrp_employers 
            SET 
                has_emails = true,
                email_extraction_attempted = true,
                email_extraction_date = CURRENT_TIMESTAMP,
                last_updated = CURRENT_TIMESTAMP
            FROM (
                SELECT DISTINCT a.employer_id
                FROM job_scrp_arbeitsagentur_jobs_v2 a
                JOIN job_scrp_job_details jd ON jd.reference_number = a.refnr
                WHERE a.employer_id IS NOT NULL
                  AND jd.contact_emails IS NOT NULL 
                  AND jd.contact_emails != ''
                  AND jd.email_source = 'our_sql_employment_agency'
            ) employer_with_emails
            WHERE job_scrp_employers.id = employer_with_emails.employer_id
              AND job_scrp_employers.has_emails = false
        `);

        console.log(`✅ Updated ${employerUpdateResult.rowCount} job_scrp_employers to has_emails = true`);

        // Step 6: Final comprehensive statistics
        console.log('\n📊 Final comprehensive statistics...');
        
        const comprehensiveStats = await client.query(`
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

        const coverageStats = await client.query(`
            SELECT 
                COUNT(DISTINCT a.employer_id) as employers_with_any_emails
            FROM job_scrp_arbeitsagentur_jobs_v2 a
            JOIN job_scrp_job_details jd ON jd.reference_number = a.refnr
            WHERE a.employer_id IS NOT NULL
              AND jd.contact_emails IS NOT NULL 
              AND jd.contact_emails != ''
        `);

        const stats = comprehensiveStats.rows[0];
        const empStats = employerStats.rows[0];
        const covStats = coverageStats.rows[0];

        console.log('\n' + '='.repeat(60));
        console.log('✅ EMPLOYER LINKING COMPLETED');
        console.log('='.repeat(60));
        console.log(`📋 Total job details: ${stats.total_job_details}`);
        console.log(`📧 Jobs with emails: ${stats.jobs_with_emails}`);
        console.log(`🏢 Total job_scrp_employers: ${empStats.total_employers}`);
        console.log(`📧 Employers marked has_emails: ${empStats.employers_with_emails}`);
        console.log(`📊 Employers with any email data: ${covStats.employers_with_any_emails}`);
        console.log(`🌐 Unique domains: ${stats.unique_domains}`);
        console.log(`📬 Unique email addresses: ${stats.unique_emails}`);
        
        const emailCoverage = (parseInt(stats.jobs_with_emails) / parseInt(stats.total_job_details) * 100).toFixed(2);
        const employerCoverage = (parseInt(empStats.employers_with_emails) / parseInt(empStats.total_employers) * 100).toFixed(2);
        const actualEmployerCoverage = (parseInt(covStats.employers_with_any_emails) / parseInt(empStats.total_employers) * 100).toFixed(2);
        
        console.log(`📈 Job email coverage: ${emailCoverage}%`);
        console.log(`📈 Employer email coverage (marked): ${employerCoverage}%`);
        console.log(`📈 Employer email coverage (actual): ${actualEmployerCoverage}%`);
        console.log('='.repeat(60));

        return {
            linkedJobs: updateResult.rowCount,
            emailPropagation: emailPropagationResult.rowCount,
            updatedEmployers: employerUpdateResult.rowCount,
            finalStats: {
                jobsWithEmails: parseInt(stats.jobs_with_emails),
                employersWithEmails: parseInt(empStats.employers_with_emails),
                actualEmployersWithEmails: parseInt(covStats.employers_with_any_emails),
                uniqueDomains: parseInt(stats.unique_domains),
                uniqueEmails: parseInt(stats.unique_emails)
            }
        };

    } catch (error) {
        console.error('❌ Employer linking failed:', error);
        throw error;
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    completeEmployerLinking()
        .then(result => {
            console.log('🎉 Employer linking completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Employer linking failed:', error);
            process.exit(1);
        });
}

module.exports = completeEmployerLinking;