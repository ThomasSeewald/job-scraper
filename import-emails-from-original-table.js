const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const dbConfig = config.production;

// Email regex pattern
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

class EmailImporter {
    constructor() {
        this.pool = new Pool(dbConfig);
        this.processedCount = 0;
        this.updatedCount = 0;
        this.emailsFoundCount = 0;
    }

    /**
     * Extract clean emails from messy text
     */
    extractEmails(text) {
        if (!text) return [];
        
        // Find all email patterns
        const matches = text.match(EMAIL_REGEX);
        if (!matches) return [];
        
        // Deduplicate and clean
        const uniqueEmails = [...new Set(matches)];
        return uniqueEmails.filter(email => {
            // Basic validation
            return email.includes('@') && 
                   email.split('@')[1].includes('.') &&
                   !email.endsWith('.') &&
                   !email.startsWith('.');
        });
    }

    /**
     * Import emails from our_sql_employment_agency to job_scrp_employers
     */
    async importEmails() {
        const client = await this.pool.connect();
        
        try {
            console.log('🚀 Starting email import from our_sql_employment_agency...');
            
            // Get all unique employer-email combinations
            const query = `
                SELECT 
                    MAX(osa.reference_number) as reference_number,
                    MAX(osa.employer) as employer_name,
                    osa.email as email_text,
                    MAX(j.employer_id) as employer_id
                FROM our_sql_employment_agency osa
                LEFT JOIN job_scrp_arbeitsagentur_jobs_v2 j ON osa.reference_number = j.refnr
                WHERE osa.email ILIKE '%@%'
                    AND j.employer_id IS NOT NULL
                GROUP BY osa.email
                ORDER BY MAX(j.employer_id)
            `;
            
            const result = await client.query(query);
            console.log(`📊 Found ${result.rows.length} employer-email records to process`);
            
            // Process each record
            for (const row of result.rows) {
                this.processedCount++;
                
                if (this.processedCount % 100 === 0) {
                    console.log(`Progress: ${this.processedCount}/${result.rows.length} processed`);
                }
                
                // Extract clean emails from the messy text
                const emails = this.extractEmails(row.email_text);
                
                if (emails.length === 0) {
                    continue;
                }
                
                this.emailsFoundCount += emails.length;
                
                // Check current employer data
                const employerQuery = `
                    SELECT id, name, contact_emails, email_extraction_attempted
                    FROM job_scrp_employers
                    WHERE id = $1
                `;
                const employerResult = await client.query(employerQuery, [row.employer_id]);
                
                if (employerResult.rows.length === 0) {
                    continue;
                }
                
                const employer = employerResult.rows[0];
                
                // Combine existing emails with new ones
                let existingEmails = [];
                if (employer.contact_emails) {
                    existingEmails = this.extractEmails(employer.contact_emails);
                }
                
                const allEmails = [...new Set([...existingEmails, ...emails])];
                const emailString = allEmails.join(', ');
                const bestEmail = allEmails[0]; // First email as best
                
                // Update employer record
                const updateQuery = `
                    UPDATE job_scrp_employers
                    SET 
                        contact_emails = $1,
                        best_email = $2,
                        has_emails = true,
                        email_extraction_attempted = true,
                        email_extraction_date = COALESCE(email_extraction_date, NOW()),
                        notes = COALESCE(notes, '') || ' [Imported from our_sql_employment_agency]',
                        last_updated = NOW()
                    WHERE id = $3
                        AND (contact_emails IS NULL OR contact_emails = '')
                `;
                
                const updateResult = await client.query(updateQuery, [
                    emailString,
                    bestEmail,
                    row.employer_id
                ]);
                
                if (updateResult.rowCount > 0) {
                    this.updatedCount++;
                    console.log(`✅ Updated employer ${employer.name} with emails: ${emailString}`);
                }
            }
            
            console.log('\n📊 Import Summary:');
            console.log(`   Total records processed: ${this.processedCount}`);
            console.log(`   Total emails found: ${this.emailsFoundCount}`);
            console.log(`   Employers updated: ${this.updatedCount}`);
            
            // Show current statistics
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as with_emails,
                    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted
                FROM job_scrp_employers
            `;
            const stats = await client.query(statsQuery);
            
            console.log('\n📈 Current Employer Statistics:');
            console.log(`   Total employers: ${stats.rows[0].total_employers}`);
            console.log(`   With emails: ${stats.rows[0].with_emails}`);
            console.log(`   Extraction attempted: ${stats.rows[0].attempted}`);
            
        } catch (error) {
            console.error('❌ Import error:', error);
            throw error;
        } finally {
            client.release();
        }
    }
    
    async cleanup() {
        await this.pool.end();
    }
}

// Run the import
async function main() {
    const importer = new EmailImporter();
    
    try {
        await importer.importEmails();
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    } finally {
        await importer.cleanup();
    }
}

if (require.main === module) {
    main();
}

module.exports = EmailImporter;