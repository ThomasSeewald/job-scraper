const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

const pool = new Pool(dbConfig);

class DatabaseSetup {
    
    async createJobsTable() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS arbeitsagentur_jobs_api (
                id SERIAL PRIMARY KEY,
                
                -- Reference and identification
                reference_number VARCHAR(50) UNIQUE NOT NULL,
                external_id VARCHAR(100),
                
                -- Job details
                title VARCHAR(500),
                profession VARCHAR(200),
                employer VARCHAR(300),
                
                -- Location information
                postal_code VARCHAR(5),
                city VARCHAR(100),
                region VARCHAR(100),
                street VARCHAR(200),
                address_additional VARCHAR(200),
                country VARCHAR(50) DEFAULT 'Deutschland',
                
                -- Coordinates
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                distance_km INTEGER,
                
                -- Dates and timing
                publication_date DATE,
                entry_date DATE,
                modification_timestamp TIMESTAMP,
                
                -- URLs and external references
                external_url TEXT,
                company_hash VARCHAR(100),
                
                -- API and scraping metadata
                api_query_params JSONB,
                raw_api_response JSONB,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                -- Data quality and status
                data_source VARCHAR(50) DEFAULT 'arbeitsagentur_api',
                is_active BOOLEAN DEFAULT true,
                quality_score INTEGER DEFAULT 100,
                
                -- Additional structured data
                job_type VARCHAR(50), -- 'job', 'ausbildung', etc.
                employment_type VARCHAR(50), -- 'vollzeit', 'teilzeit', etc.
                
                CONSTRAINT unique_reference_number UNIQUE(reference_number),
                CONSTRAINT valid_coordinates CHECK (
                    (latitude IS NULL AND longitude IS NULL) OR 
                    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
                )
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createTableSQL);
            console.log('✅ Table arbeitsagentur_jobs_api created successfully');
            
            // Create indexes for performance
            await this.createIndexes(client);
            
        } finally {
            client.release();
        }
    }
    
    async createIndexes(client) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_jobs_postal_code ON arbeitsagentur_jobs_api(postal_code)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_employer ON arbeitsagentur_jobs_api(employer)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_profession ON arbeitsagentur_jobs_api(profession)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_city ON arbeitsagentur_jobs_api(city)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_region ON arbeitsagentur_jobs_api(region)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_publication_date ON arbeitsagentur_jobs_api(publication_date)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON arbeitsagentur_jobs_api(scraped_at)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON arbeitsagentur_jobs_api(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_coordinates ON arbeitsagentur_jobs_api(latitude, longitude)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_raw_api_gin ON arbeitsagentur_jobs_api USING GIN(raw_api_response)',
            'CREATE INDEX IF NOT EXISTS idx_jobs_query_params_gin ON arbeitsagentur_jobs_api USING GIN(api_query_params)'
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
                console.log(`✅ Index created: ${indexSQL.split(' ')[5]}`);
            } catch (error) {
                console.error(`❌ Failed to create index: ${error.message}`);
            }
        }
    }
    
    async createScrapingLogTable() {
        const createLogTableSQL = `
            CREATE TABLE IF NOT EXISTS scraping_log (
                id SERIAL PRIMARY KEY,
                
                -- Scraping session information
                session_id VARCHAR(100) NOT NULL,
                postal_code VARCHAR(5),
                city VARCHAR(100),
                
                -- Results
                jobs_found INTEGER DEFAULT 0,
                jobs_inserted INTEGER DEFAULT 0,
                jobs_updated INTEGER DEFAULT 0,
                jobs_skipped INTEGER DEFAULT 0,
                
                -- Status and timing
                status VARCHAR(50), -- 'success', 'error', 'partial'
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                duration_seconds INTEGER,
                
                -- Error handling
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                
                -- API information
                api_response_code INTEGER,
                api_query_params JSONB,
                
                -- Statistics
                total_available INTEGER,
                pages_scraped INTEGER
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createLogTableSQL);
            console.log('✅ Table scraping_log created successfully');
        } finally {
            client.release();
        }
    }
    
    async testConnection() {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
            console.log('✅ Database connection successful');
            console.log(`🕐 Current time: ${result.rows[0].current_time}`);
            console.log(`🐘 PostgreSQL version: ${result.rows[0].postgres_version.split(' ')[0]}`);
            return true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            return false;
        } finally {
            client.release();
        }
    }
    
    async getTableStats() {
        const client = await pool.connect();
        try {
            const queries = [
                "SELECT COUNT(*) as total_jobs FROM arbeitsagentur_jobs_api",
                "SELECT COUNT(DISTINCT postal_code) as unique_postcodes FROM arbeitsagentur_jobs_api",
                "SELECT COUNT(DISTINCT employer) as unique_employers FROM arbeitsagentur_jobs_api",
                "SELECT COUNT(*) as active_jobs FROM arbeitsagentur_jobs_api WHERE is_active = true",
                "SELECT COUNT(*) as recent_jobs FROM arbeitsagentur_jobs_api WHERE scraped_at > NOW() - INTERVAL '24 hours'"
            ];
            
            const stats = {};
            for (const query of queries) {
                const result = await client.query(query);
                const key = query.match(/as (\w+)/)[1];
                stats[key] = parseInt(result.rows[0][key]);
            }
            
            console.log('\n📊 Database Statistics:');
            console.log(`   Total jobs: ${stats.total_jobs}`);
            console.log(`   Unique postal codes: ${stats.unique_postcodes}`);
            console.log(`   Unique job_scrp_employers: ${stats.unique_employers}`);
            console.log(`   Active jobs: ${stats.active_jobs}`);
            console.log(`   Jobs scraped in last 24h: ${stats.recent_jobs}`);
            
            return stats;
            
        } finally {
            client.release();
        }
    }
}

async function main() {
    const setup = new DatabaseSetup();
    
    try {
        console.log('🚀 Starting database setup...');
        
        // Test connection
        const connected = await setup.testConnection();
        if (!connected) {
            throw new Error('Database connection failed');
        }
        
        // Create tables
        await setup.createJobsTable();
        await setup.createScrapingLogTable();
        
        // Show statistics
        await setup.getTableStats();
        
        console.log('\n✅ Database setup completed successfully!');
        console.log('Ready for job scraping operations.');
        
    } catch (error) {
        console.error('❌ Database setup failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run setup if called directly
if (require.main === module) {
    main();
}

module.exports = DatabaseSetup;