const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

const pool = new Pool(dbConfig);

class JobDetailsTableSetup {
    
    /**
     * Create job details table for storing scraped detail page information
     */
    async createJobDetailsTable() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS job_scrp_job_details (
                id SERIAL PRIMARY KEY,
                
                -- Reference to main job record
                reference_number VARCHAR(50) UNIQUE NOT NULL,
                arbeitsagentur_job_id INTEGER REFERENCES job_scrp_arbeitsagentur_jobs_v2(id),
                
                -- Detailed job information from detail page
                full_description TEXT,
                requirements TEXT,
                benefits TEXT[],
                skills TEXT[],
                
                -- Contact information (simplified focus on emails)
                contact_emails TEXT, -- All emails found, comma-separated
                best_email VARCHAR(255), -- Prioritized best email  
                company_domain VARCHAR(100), -- Extracted domain
                
                -- Application information
                application_url TEXT,
                application_email VARCHAR(255),
                application_instructions TEXT,
                
                -- Job details
                job_type VARCHAR(100), -- 'Vollzeit', 'Teilzeit', etc.
                contract_type VARCHAR(100), -- 'unbefristet', 'befristet', etc.
                work_schedule VARCHAR(200),
                salary_info TEXT,
                
                -- Company details
                company_description TEXT,
                company_size VARCHAR(100),
                company_industry VARCHAR(200),
                
                -- Scraping metadata
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                scraping_duration_ms INTEGER,
                captcha_solved BOOLEAN DEFAULT false,
                scraping_success BOOLEAN DEFAULT true,
                scraping_error TEXT,
                
                -- Data quality indicators
                has_emails BOOLEAN DEFAULT false,
                email_count INTEGER DEFAULT 0,
                data_completeness_score INTEGER DEFAULT 0,
                
                -- Raw data for debugging/analysis
                raw_page_text TEXT,
                source_url TEXT,
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT job_details_unique_ref_num UNIQUE(reference_number)
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createTableSQL);
            console.log('✅ Table job_scrp_job_details created successfully');
            
            // Create indexes for performance
            await this.createDetailIndexes(client);
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Create indexes for job details table
     */
    async createDetailIndexes(client) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_job_details_ref_number ON job_scrp_job_details(reference_number)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_arbeitsagentur_id ON job_scrp_job_details(arbeitsagentur_job_id)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_scraped_at ON job_scrp_job_details(scraped_at)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_has_emails ON job_scrp_job_details(has_emails)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_best_email ON job_scrp_job_details(best_email) WHERE best_email IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_job_details_company_domain ON job_scrp_job_details(company_domain)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_success ON job_scrp_job_details(scraping_success)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_job_type ON job_scrp_job_details(job_type)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_contract_type ON job_scrp_job_details(contract_type)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_benefits_gin ON job_scrp_job_details USING GIN(benefits)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_skills_gin ON job_scrp_job_details USING GIN(skills)',
            'CREATE INDEX IF NOT EXISTS idx_job_details_text_search ON job_scrp_job_details USING GIN(to_tsvector(\'german\', COALESCE(full_description, \'\') || \' \' || COALESCE(requirements, \'\')))'
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
    }
    
    /**
     * Create detail scraping log table
     */
    async createDetailScrapingLogTable() {
        const createLogTableSQL = `
            CREATE TABLE IF NOT EXISTS detail_scraping_log (
                id SERIAL PRIMARY KEY,
                
                -- Session information
                session_id VARCHAR(100) NOT NULL,
                batch_id VARCHAR(100),
                
                -- Job reference
                reference_number VARCHAR(50) NOT NULL,
                
                -- Scraping results
                status VARCHAR(50), -- 'success', 'error', 'captcha_failed', 'timeout'
                duration_ms INTEGER,
                
                -- Contact extraction results
                email_found BOOLEAN DEFAULT false,
                phone_found BOOLEAN DEFAULT false,
                website_found BOOLEAN DEFAULT false,
                
                -- Content analysis
                description_length INTEGER DEFAULT 0,
                requirements_length INTEGER DEFAULT 0,
                benefits_count INTEGER DEFAULT 0,
                skills_count INTEGER DEFAULT 0,
                
                -- Error handling
                error_message TEXT,
                captcha_attempts INTEGER DEFAULT 0,
                captcha_solved BOOLEAN DEFAULT false,
                
                -- Timestamps
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                
                -- Source URL for debugging
                source_url TEXT
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createLogTableSQL);
            console.log('✅ Table detail_scraping_log created successfully');
            
            // Create indexes for log table
            const logIndexes = [
                'CREATE INDEX IF NOT EXISTS idx_detail_log_ref_number ON detail_scraping_log(reference_number)',
                'CREATE INDEX IF NOT EXISTS idx_detail_log_session ON detail_scraping_log(session_id)',
                'CREATE INDEX IF NOT EXISTS idx_detail_log_status ON detail_scraping_log(status)',
                'CREATE INDEX IF NOT EXISTS idx_detail_log_started_at ON detail_scraping_log(started_at)'
            ];
            
            for (const indexSQL of logIndexes) {
                try {
                    await client.query(indexSQL);
                    const indexName = indexSQL.match(/idx_[a-z_]+/)[0];
                    console.log(`✅ Log index created: ${indexName}`);
                } catch (error) {
                    console.error(`❌ Failed to create log index: ${error.message}`);
                }
            }
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Create helpful views for analysis
     */
    async createAnalysisViews() {
        const views = [
            {
                name: 'job_details_summary',
                sql: `
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
                        jd.job_type,
                        jd.contract_type,
                        jd.scraped_at as detail_scraped_at,
                        jd.scraping_success,
                        jd.data_completeness_score
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                    WHERE j.is_active = true;
                `
            },
            {
                name: 'contact_extraction_stats',
                sql: `
                    CREATE OR REPLACE VIEW contact_extraction_stats AS
                    SELECT 
                        COUNT(*) as total_jobs_scraped,
                        COUNT(CASE WHEN best_email IS NOT NULL THEN 1 END) as jobs_with_best_email,
                        COUNT(CASE WHEN contact_emails IS NOT NULL THEN 1 END) as jobs_with_any_emails,
                        COUNT(CASE WHEN has_emails = true THEN 1 END) as jobs_with_emails_flag,
                        ROUND(AVG(email_count), 2) as avg_emails_per_job,
                        ROUND(AVG(data_completeness_score), 2) as avg_completeness_score,
                        COUNT(DISTINCT company_domain) as unique_domains
                    FROM job_scrp_job_details
                    WHERE scraping_success = true;
                `
            }
        ];
        
        const client = await pool.connect();
        try {
            for (const view of views) {
                await client.query(view.sql);
                console.log(`✅ View created: ${view.name}`);
            }
        } finally {
            client.release();
        }
    }
    
    /**
     * Test connection and show existing data
     */
    async testConnectionAndShowStats() {
        const client = await pool.connect();
        try {
            // Test connection
            const result = await client.query('SELECT NOW() as current_time');
            console.log('✅ Database connection successful');
            console.log(`🕐 Current time: ${result.rows[0].current_time}`);
            
            // Check existing jobs that could be detail-scraped
            const jobsAvailable = await client.query(`
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '7 days' THEN 1 END) as recent_jobs,
                    COUNT(DISTINCT arbeitsort_plz) as unique_plz
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE is_active = true AND refnr IS NOT NULL
            `);
            
            console.log('\n📊 Available Jobs for Detail Scraping:');
            console.log(`   Total active jobs: ${jobsAvailable.rows[0].total_jobs}`);
            console.log(`   Recent jobs (7 days): ${jobsAvailable.rows[0].recent_jobs}`);
            console.log(`   Unique postal codes: ${jobsAvailable.rows[0].unique_plz}`);
            
            // Check if detail table exists and has data
            try {
                const detailStats = await client.query(`
                    SELECT 
                        COUNT(*) as total_details,
                        COUNT(CASE WHEN has_contact_info = true THEN 1 END) as with_contact,
                        COUNT(CASE WHEN scraping_success = true THEN 1 END) as successful
                    FROM job_scrp_job_details
                `);
                
                console.log('\n📋 Existing Detail Data:');
                console.log(`   Total details scraped: ${detailStats.rows[0].total_details}`);
                console.log(`   With contact info: ${detailStats.rows[0].with_contact}`);
                console.log(`   Successful scrapes: ${detailStats.rows[0].successful}`);
            } catch (error) {
                console.log('\n📋 No existing detail data found (table may not exist yet)');
            }
            
            return true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            return false;
        } finally {
            client.release();
        }
    }
}

async function main() {
    const setup = new JobDetailsTableSetup();
    
    try {
        console.log('🚀 Setting up job details database infrastructure...');
        
        // Test connection and show current state
        const connected = await setup.testConnectionAndShowStats();
        if (!connected) {
            throw new Error('Database connection failed');
        }
        
        // Create job details table
        await setup.createJobDetailsTable();
        
        // Create detail scraping log table
        await setup.createDetailScrapingLogTable();
        
        // Create analysis views
        await setup.createAnalysisViews();
        
        console.log('\n✅ Job details database infrastructure setup completed!');
        console.log('📊 Ready for detail page scraping operations.');
        console.log('\nNext steps:');
        console.log('  1. Integrate detail scraper with existing scanners');
        console.log('  2. Start detail scraping for new jobs');
        console.log('  3. Monitor via dashboard views');
        
    } catch (error) {
        console.error('❌ Job details setup failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run setup if called directly
if (require.main === module) {
    main();
}

module.exports = JobDetailsTableSetup;