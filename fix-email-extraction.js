const { Client } = require('pg');

async function fixEmailExtractionIssues() {
    const client = new Client({
        host: 'localhost',
        port: 5473,
        database: 'jetzt',
        user: 'odoo',
        password: 'odoo'
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // Fix the specific wolf@affby.de case
        const fixAffby = await client.query(`
            UPDATE job_scrp_job_details 
            SET contact_emails = 'wolf@affby.de',
                best_email = 'wolf@affby.de',
                email_count = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE reference_number = '10001-1001480725-S'
            RETURNING reference_number, contact_emails, best_email
        `);
        
        if (fixAffby.rows.length > 0) {
            console.log('Fixed affby.de email:', fixAffby.rows[0]);
        }

        // Find other potentially problematic emails
        const problematicEmails = await client.query(`
            SELECT id, reference_number, contact_emails, best_email
            FROM job_scrp_job_details
            WHERE contact_emails LIKE '%@%.de%@%'
               OR contact_emails ~ '[a-z]+@[a-z]+\\.de[a-z]+'
               OR contact_emails ~ '@.*\\.(de|com|net|org)[a-z]+'
            LIMIT 20
        `);

        console.log(`\nFound ${problematicEmails.rows.length} potentially problematic email entries:`);
        
        for (const row of problematicEmails.rows) {
            console.log(`\nJob ${row.reference_number}:`);
            console.log(`  Current emails: ${row.contact_emails}`);
            
            // Extract and clean emails
            const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?![a-zA-Z])/g;
            const matches = row.contact_emails.match(emailRegex);
            
            if (matches) {
                const cleanedEmails = [...new Set(matches)]; // Remove duplicates
                const cleanedString = cleanedEmails.join(', ');
                
                if (cleanedString !== row.contact_emails) {
                    console.log(`  Cleaned emails: ${cleanedString}`);
                    
                    // Update the record
                    await client.query(`
                        UPDATE job_scrp_job_details 
                        SET contact_emails = $1,
                            best_email = $2,
                            email_count = $3,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $4
                    `, [cleanedString, cleanedEmails[0], cleanedEmails.length, row.id]);
                    
                    console.log('  ✅ Updated!');
                }
            }
        }

        console.log('\nEmail extraction fixes completed!');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.end();
    }
}

fixEmailExtractionIssues();