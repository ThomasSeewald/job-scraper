const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

const pool = new Pool(dbConfig);

async function migrateJobDetailsTable() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Migrating job_scrp_job_details table to simplified email-focused schema...');
        
        // First, check if there's existing data we need to preserve
        const existingDataQuery = `
            SELECT COUNT(*) as count FROM job_scrp_job_details WHERE scraping_success = true
        `;
        
        let existingCount = 0;
        try {
            const countResult = await client.query(existingDataQuery);
            existingCount = parseInt(countResult.rows[0].count);
            console.log(`📊 Found ${existingCount} existing detail records`);
        } catch (error) {
            console.log('📋 No existing job_scrp_job_details table found');
        }

        // Drop existing table and recreate with new schema
        console.log('🗑️  Dropping existing job_scrp_job_details table...');
        await client.query('DROP TABLE IF EXISTS job_scrp_job_details CASCADE');
        
        console.log('🏗️  Creating new job_scrp_job_details table with simplified schema...');
        const createTableSQL = `
            CREATE TABLE job_scrp_job_details (
                id SERIAL PRIMARY KEY,
                
                -- Reference to main job record
                reference_number VARCHAR(50) UNIQUE NOT NULL,
                arbeitsagentur_job_id INTEGER REFERENCES job_scrp_arbeitsagentur_jobs_v2(id),
                
                -- Simplified contact information (focus on emails only)
                contact_emails TEXT, -- All emails found, comma-separated
                best_email VARCHAR(255), -- Prioritized best email  
                company_domain VARCHAR(100), -- Extracted domain
                
                -- Email extraction metadata
                has_emails BOOLEAN DEFAULT false,
                email_count INTEGER DEFAULT 0,
                
                -- Scraping metadata
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                scraping_duration_ms INTEGER,
                captcha_solved BOOLEAN DEFAULT false,
                scraping_success BOOLEAN DEFAULT true,
                scraping_error TEXT,
                
                -- Source tracking
                source_url TEXT,
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT job_details_unique_ref_num UNIQUE(reference_number)
            );
        `;
        
        await client.query(createTableSQL);
        console.log('✅ New job_scrp_job_details table created');
        
        // Create optimized indexes for email-focused queries
        console.log('🔍 Creating indexes...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_job_details_ref_number ON job_scrp_job_details(reference_number)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_arbeitsagentur_id ON job_scrp_job_details(arbeitsagentur_job_id)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_scraped_at ON job_scrp_job_details(scraped_at)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_has_emails ON job_scrp_job_details(has_emails)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_best_email ON job_scrp_job_details(best_email) WHERE best_email IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_job_details_company_domain ON job_scrp_job_details(company_domain)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_success ON job_scrp_job_details(scraping_success)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_email_count ON job_scrp_job_details(email_count) WHERE email_count > 0'
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
                const indexName = indexSQL.match(/idx_[a-z_]+/)[0];
                console.log(`✅ Index created: ${indexName}`);
            } catch (error) {
                console.error(`❌ Failed to create index: ${error.message}`);
            }
        }
        
        // Create updated views
        console.log('📊 Creating analysis views...');
        
        const summaryViewSQL = `
            CREATE OR REPLACE VIEW job_details_summary AS
            SELECT 
                j.refnr,
                j.titel,
                j.arbeitgeber,
                j.arbeitsort_ort,
                j.arbeitsort_plz,
                jd.contact_emails,
                jd.best_email,
                jd.company_domain,
                jd.has_emails,
                jd.email_count,
                jd.scraped_at as detail_scraped_at,
                jd.scraping_success
            FROM job_scrp_arbeitsagentur_jobs_v2 j
            LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
            WHERE j.is_active = true;
        `;
        
        const statsViewSQL = `
            CREATE OR REPLACE VIEW email_extraction_stats AS
            SELECT 
                COUNT(*) as total_jobs_scraped,
                COUNT(CASE WHEN best_email IS NOT NULL THEN 1 END) as jobs_with_best_email,
                COUNT(CASE WHEN contact_emails IS NOT NULL THEN 1 END) as jobs_with_any_emails,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as jobs_with_emails_flag,
                ROUND(AVG(email_count), 2) as avg_emails_per_job,
                COUNT(DISTINCT company_domain) as unique_domains,
                ROUND(AVG(scraping_duration_ms), 0) as avg_scraping_time_ms,
                COUNT(CASE WHEN captcha_solved = true THEN 1 END) as captcha_solves,
                MAX(scraped_at) as last_scrape_time
            FROM job_scrp_job_details
            WHERE scraping_success = true;
        `;
        
        await client.query(summaryViewSQL);
        console.log('✅ View created: job_details_summary');
        
        await client.query(statsViewSQL);
        console.log('✅ View created: email_extraction_stats');
        
        console.log('\n🎉 Migration completed successfully!');
        console.log('📧 New focus: Email extraction only');
        console.log('🚫 Excluded: Phone, website scraping (simplified approach)');
        console.log('⚡ Optimized: For email discovery and domain tracking');
        
        if (existingCount > 0) {
            console.log(`\n⚠️  Note: ${existingCount} previous detail records were cleared`);
            console.log('   Run the simplified scraper to rebuild email data');
        }
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    try {
        await migrateJobDetailsTable();
        console.log('\n✅ Ready to run simplified detail scraper!');
        console.log('Commands:');
        console.log('  node src/simplified-detail-scraper.js 10    # Test with 10 jobs');
        console.log('  node src/simplified-detail-scraper.js 100   # Scrape 100 jobs');
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { migrateJobDetailsTable };