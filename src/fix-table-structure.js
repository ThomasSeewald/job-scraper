const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class TableStructureFixer {
    
    async fixTableStructure() {
        const client = await pool.connect();
        
        try {
            console.log('🔧 Fixing table structure for legacy data compatibility...');
            
            // Drop problematic indexes first
            await client.query('DROP INDEX IF EXISTS idx_v2_website');
            await client.query('DROP INDEX IF EXISTS idx_v2_email');
            console.log('✅ Dropped problematic indexes');
            
            // Alter column sizes to accommodate legacy data
            const alterations = [
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN titel TYPE TEXT',
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN beruf TYPE TEXT', 
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN arbeitgeber TYPE TEXT',
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN arbeitsort_ort TYPE TEXT',
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN arbeitsort_strasse TYPE TEXT',
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN email TYPE TEXT',
                'ALTER TABLE job_scrp_arbeitsagentur_jobs_v2 ALTER COLUMN new_email TYPE TEXT'
            ];
            
            for (const sql of alterations) {
                await client.query(sql);
                console.log(`✅ ${sql}`);
            }
            
            // Recreate indexes without problematic fields or with hash indexes for long values
            const newIndexes = [
                'CREATE INDEX IF NOT EXISTS idx_v2_refnr ON job_scrp_arbeitsagentur_jobs_v2(refnr)',
                'CREATE INDEX IF NOT EXISTS idx_v2_arbeitgeber_hash ON job_scrp_arbeitsagentur_jobs_v2 USING HASH(arbeitgeber)',
                'CREATE INDEX IF NOT EXISTS idx_v2_beruf_hash ON job_scrp_arbeitsagentur_jobs_v2 USING HASH(beruf)',
                'CREATE INDEX IF NOT EXISTS idx_v2_arbeitsort_plz ON job_scrp_arbeitsagentur_jobs_v2(arbeitsort_plz)',
                'CREATE INDEX IF NOT EXISTS idx_v2_arbeitsort_ort_hash ON job_scrp_arbeitsagentur_jobs_v2 USING HASH(arbeitsort_ort)',
                
                // For email and website, create partial indexes only for non-null values
                'CREATE INDEX IF NOT EXISTS idx_v2_email_partial ON job_scrp_arbeitsagentur_jobs_v2(LEFT(email, 100)) WHERE email IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_v2_website_partial ON job_scrp_arbeitsagentur_jobs_v2(LEFT(website, 100)) WHERE website IS NOT NULL',
                
                'CREATE INDEX IF NOT EXISTS idx_v2_veroeffentlichung ON job_scrp_arbeitsagentur_jobs_v2(aktuelleVeroeffentlichungsdatum)',
                'CREATE INDEX IF NOT EXISTS idx_v2_scraped_at ON job_scrp_arbeitsagentur_jobs_v2(scraped_at)',
                'CREATE INDEX IF NOT EXISTS idx_v2_source_active ON job_scrp_arbeitsagentur_jobs_v2(data_source, is_active)'
            ];
            
            for (const indexSQL of newIndexes) {
                try {
                    await client.query(indexSQL);
                    console.log(`✅ Index created: ${indexSQL.split(' ')[5]}`);
                } catch (error) {
                    console.warn(`⚠️ Index creation warning: ${error.message}`);
                }
            }
            
            console.log('\n✅ Table structure fixed for legacy data compatibility');
            
        } finally {
            client.release();
        }
    }
    
    async analyzeDataSizes() {
        const client = await pool.connect();
        
        try {
            console.log('\n🔍 Analyzing data sizes in old table...');
            
            const sizeQueries = [
                "SELECT MAX(LENGTH(title)) as max_title_length FROM our_sql_employment_agency WHERE title IS NOT NULL",
                "SELECT MAX(LENGTH(occupation)) as max_occupation_length FROM our_sql_employment_agency WHERE occupation IS NOT NULL", 
                "SELECT MAX(LENGTH(employer)) as max_employer_length FROM our_sql_employment_agency WHERE employer IS NOT NULL",
                "SELECT MAX(LENGTH(email)) as max_email_length FROM our_sql_employment_agency WHERE email IS NOT NULL",
                "SELECT MAX(LENGTH(website)) as max_website_length FROM our_sql_employment_agency WHERE website IS NOT NULL",
                "SELECT MAX(LENGTH(new_website)) as max_new_website_length FROM our_sql_employment_agency WHERE new_website IS NOT NULL"
            ];
            
            console.log('\n📏 Maximum field lengths in legacy data:');
            for (const query of sizeQueries) {
                const result = await client.query(query);
                const field = query.match(/max_(\w+)_length/)[1];
                const maxLength = result.rows[0][`max_${field}_length`];
                console.log(`   ${field}: ${maxLength} characters`);
            }
            
        } finally {
            client.release();
        }
    }
}

async function main() {
    const fixer = new TableStructureFixer();
    
    try {
        await fixer.analyzeDataSizes();
        await fixer.fixTableStructure();
        
        console.log('\n🎉 Table structure optimization completed!');
        console.log('Ready for legacy data migration.');
        
    } catch (error) {
        console.error('❌ Table structure fix failed:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = TableStructureFixer;