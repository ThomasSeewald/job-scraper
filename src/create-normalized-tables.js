const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class NormalizedTableCreator {
    
    async createEmployersTable() {
        const createEmployersSQL = `
            CREATE TABLE IF NOT EXISTS job_scrp_employers (
                id SERIAL PRIMARY KEY,
                
                -- Employer identification
                arbeitgeber VARCHAR(300) NOT NULL,
                arbeitgeber_hash VARCHAR(64) UNIQUE, -- MD5 hash for duplicate detection
                
                -- Contact information
                email TEXT,
                new_email TEXT,
                website TEXT,
                new_website TEXT,
                
                -- Location information  
                arbeitsort_plz VARCHAR(5),
                arbeitsort_ort VARCHAR(100),
                arbeitsort_region VARCHAR(100),
                arbeitsort_strasse VARCHAR(200),
                arbeitsort_land VARCHAR(50) DEFAULT 'Deutschland',
                
                -- Coordinates (average of all locations for this employer)
                avg_latitude DOUBLE PRECISION,
                avg_longitude DOUBLE PRECISION,
                
                -- Statistics
                total_job_positions INTEGER DEFAULT 0,
                total_ausbildung_positions INTEGER DEFAULT 0,
                unique_beruf_count INTEGER DEFAULT 0,
                
                -- Data quality and metadata
                data_completeness_score INTEGER DEFAULT 0, -- 0-100 based on available contact info
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                
                -- Source tracking
                data_sources JSONB, -- ["migration", "api", "scraping"]
                
                CONSTRAINT unique_arbeitgeber_hash UNIQUE(arbeitgeber_hash),
                CONSTRAINT valid_coordinates CHECK (
                    (avg_latitude IS NULL AND avg_longitude IS NULL) OR 
                    (avg_latitude BETWEEN -90 AND 90 AND avg_longitude BETWEEN -180 AND 180)
                )
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createEmployersSQL);
            console.log('✅ Table job_scrp_employers created successfully');
            await this.createEmployersIndexes(client);
        } finally {
            client.release();
        }
    }
    
    async createEmployersIndexes(client) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_employers_arbeitgeber ON job_scrp_employers(arbeitgeber)',
            'CREATE INDEX IF NOT EXISTS idx_employers_hash ON job_scrp_employers(arbeitgeber_hash)',
            'CREATE INDEX IF NOT EXISTS idx_employers_plz ON job_scrp_employers(arbeitsort_plz)',
            'CREATE INDEX IF NOT EXISTS idx_employers_ort ON job_scrp_employers(arbeitsort_ort)',
            'CREATE INDEX IF NOT EXISTS idx_employers_region ON job_scrp_employers(arbeitsort_region)',
            'CREATE INDEX IF NOT EXISTS idx_employers_email_partial ON job_scrp_employers(LEFT(email, 100)) WHERE email IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_employers_website_partial ON job_scrp_employers(LEFT(website, 100)) WHERE website IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_employers_active ON job_scrp_employers(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_employers_data_sources_gin ON job_scrp_employers USING GIN(data_sources)',
            'CREATE INDEX IF NOT EXISTS idx_employers_coordinates ON job_scrp_employers(avg_latitude, avg_longitude)',
            'CREATE INDEX IF NOT EXISTS idx_employers_job_stats ON job_scrp_employers(total_job_positions, total_ausbildung_positions)'
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
                console.log(`✅ Employer index created: ${indexSQL.split(' ')[5]}`);
            } catch (error) {
                console.error(`❌ Failed to create employer index: ${error.message}`);
            }
        }
    }
    
    async createJobPositionsTable() {
        const createJobPositionsSQL = `
            CREATE TABLE IF NOT EXISTS job_positions (
                id SERIAL PRIMARY KEY,
                
                -- Foreign key to job_scrp_employers
                employer_id INTEGER NOT NULL REFERENCES job_scrp_employers(id) ON DELETE CASCADE,
                
                -- Job information (NO refnr to avoid duplicates)
                titel TEXT NOT NULL,
                beruf TEXT NOT NULL,
                job_type VARCHAR(20) NOT NULL, -- 'job', 'ausbildung', 'unknown'
                
                -- Job details
                eintrittsdatum DATE,
                aktuelleVeroeffentlichungsdatum DATE,
                
                -- Unique constraint to prevent exact duplicates
                position_hash VARCHAR(64), -- Hash of employer_id + titel + beruf + job_type
                
                -- Statistics
                times_seen INTEGER DEFAULT 1, -- How often this exact position was found
                
                -- Metadata
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                
                -- Source tracking
                data_sources JSONB, -- ["migration", "api"]
                
                CONSTRAINT unique_position_hash UNIQUE(position_hash),
                CONSTRAINT valid_job_type CHECK (job_type IN ('job', 'ausbildung', 'unknown'))
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createJobPositionsSQL);
            console.log('✅ Table job_positions created successfully');
            await this.createJobPositionsIndexes(client);
        } finally {
            client.release();
        }
    }
    
    async createJobPositionsIndexes(client) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_job_positions_employer ON job_positions(employer_id)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_beruf ON job_positions(beruf)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_job_type ON job_positions(job_type)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_hash ON job_positions(position_hash)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_active ON job_positions(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_first_seen ON job_positions(first_seen)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_times_seen ON job_positions(times_seen)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_data_sources_gin ON job_positions USING GIN(data_sources)',
            
            // Compound indexes for common queries
            'CREATE INDEX IF NOT EXISTS idx_job_positions_employer_type ON job_positions(employer_id, job_type)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_beruf_type ON job_positions(beruf, job_type)',
            'CREATE INDEX IF NOT EXISTS idx_job_positions_employer_beruf ON job_positions(employer_id, beruf)'
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
                console.log(`✅ Job position index created: ${indexSQL.split(' ')[5]}`);
            } catch (error) {
                console.error(`❌ Failed to create job position index: ${error.message}`);
            }
        }
    }
    
    async createHelperFunctions() {
        const client = await pool.connect();
        
        try {
            // Enable pgcrypto extension
            await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
            console.log('✅ pgcrypto extension enabled');
        } catch (error) {
            console.warn('⚠️ Could not enable pgcrypto, using alternative hash method');
        } finally {
            client.release();
        }
        
        const helperFunctionsSQL = `
            -- Function to generate employer hash (using MD5)
            CREATE OR REPLACE FUNCTION generate_employer_hash(arbeitgeber_name TEXT, plz TEXT, ort TEXT)
            RETURNS VARCHAR(64) AS $$
            BEGIN
                RETURN md5(
                    LOWER(TRIM(arbeitgeber_name)) || '|' || 
                    COALESCE(plz, '') || '|' || 
                    COALESCE(LOWER(TRIM(ort)), '')
                );
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
            
            -- Function to generate job position hash  
            CREATE OR REPLACE FUNCTION generate_position_hash(emp_id INTEGER, titel_val TEXT, beruf_val TEXT, job_type_val TEXT)
            RETURNS VARCHAR(64) AS $$
            BEGIN
                RETURN md5(
                    emp_id::TEXT || '|' ||
                    LOWER(TRIM(COALESCE(titel_val, ''))) || '|' || 
                    LOWER(TRIM(COALESCE(beruf_val, ''))) || '|' ||
                    LOWER(TRIM(job_type_val))
                );
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
            
            -- Function to calculate data completeness score
            CREATE OR REPLACE FUNCTION calculate_data_completeness(
                email_val TEXT, new_email_val TEXT, website_val TEXT, new_website_val TEXT,
                plz_val TEXT, strasse_val TEXT, ort_val TEXT
            ) RETURNS INTEGER AS $$
            DECLARE
                score INTEGER := 0;
            BEGIN
                -- Email data (40 points max)
                IF email_val IS NOT NULL AND email_val != '' THEN score := score + 25; END IF;
                IF new_email_val IS NOT NULL AND new_email_val != '' THEN score := score + 15; END IF;
                
                -- Website data (30 points max)  
                IF website_val IS NOT NULL AND website_val != '' THEN score := score + 20; END IF;
                IF new_website_val IS NOT NULL AND new_website_val != '' THEN score := score + 10; END IF;
                
                -- Location data (30 points max)
                IF plz_val IS NOT NULL AND plz_val != '' THEN score := score + 15; END IF;
                IF strasse_val IS NOT NULL AND strasse_val != '' THEN score := score + 10; END IF;
                IF ort_val IS NOT NULL AND ort_val != '' THEN score := score + 5; END IF;
                
                RETURN LEAST(score, 100);
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
        `;
        
        const client2 = await pool.connect();
        try {
            await client2.query(helperFunctionsSQL);
            console.log('✅ Helper functions created successfully');
        } finally {
            client2.release();
        }
    }
    
    async testTableStructure() {
        const client = await pool.connect();
        
        try {
            console.log('\n🧪 Testing table structure...');
            
            // Test employer hash function
            const hashTest = await client.query(`
                SELECT generate_employer_hash('Test GmbH', '12345', 'Berlin') as test_hash
            `);
            console.log(`✅ Employer hash function works: ${hashTest.rows[0].test_hash}`);
            
            // Test position hash function
            const posHashTest = await client.query(`
                SELECT generate_position_hash(1, 'Software Developer', 'Informatiker', 'job') as test_hash
            `);
            console.log(`✅ Position hash function works: ${posHashTest.rows[0].test_hash}`);
            
            // Test completeness score function
            const scoreTest = await client.query(`
                SELECT calculate_data_completeness(
                    'test@example.com', NULL, 'https://example.com', NULL,
                    '12345', 'Test Str. 1', 'Berlin'
                ) as test_score
            `);
            console.log(`✅ Completeness score function works: ${scoreTest.rows[0].test_score}%`);
            
        } finally {
            client.release();
        }
    }
    
    async getTablesInfo() {
        const client = await pool.connect();
        
        try {
            console.log('\n📊 Normalized table structure overview:');
            
            const employersInfo = await client.query(`
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
                    COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website,
                    AVG(data_completeness_score) as avg_completeness
                FROM job_scrp_employers
            `);
            
            const positionsInfo = await client.query(`
                SELECT 
                    COUNT(*) as total_positions,
                    COUNT(CASE WHEN job_type = 'job' THEN 1 END) as jobs,
                    COUNT(CASE WHEN job_type = 'ausbildung' THEN 1 END) as ausbildung,
                    COUNT(DISTINCT beruf) as unique_berufe
                FROM job_positions
            `);
            
            console.log('\n👥 Employers:');
            if (employersInfo.rows[0].total_employers > 0) {
                const emp = employersInfo.rows[0];
                console.log(`   Total: ${emp.total_employers}`);
                console.log(`   With Email: ${emp.with_email}`);
                console.log(`   With Website: ${emp.with_website}`);
                console.log(`   Avg Completeness: ${parseFloat(emp.avg_completeness).toFixed(1)}%`);
            } else {
                console.log('   No job_scrp_employers yet - ready for normalization');
            }
            
            console.log('\n💼 Job Positions:');
            if (positionsInfo.rows[0].total_positions > 0) {
                const pos = positionsInfo.rows[0];
                console.log(`   Total: ${pos.total_positions}`);
                console.log(`   Jobs: ${pos.jobs}`);
                console.log(`   Ausbildung: ${pos.ausbildung}`);
                console.log(`   Unique Berufe: ${pos.unique_berufe}`);
            } else {
                console.log('   No positions yet - ready for normalization');
            }
            
        } finally {
            client.release();
        }
    }
}

async function main() {
    const creator = new NormalizedTableCreator();
    
    try {
        console.log('🏗️ Creating normalized table structure...');
        
        // Create tables
        await creator.createEmployersTable();
        await creator.createJobPositionsTable();
        
        // Create helper functions
        await creator.createHelperFunctions();
        
        // Test everything
        await creator.testTableStructure();
        
        // Show current state
        await creator.getTablesInfo();
        
        console.log('\n✅ Normalized table structure created successfully!');
        console.log('Ready for data normalization from job_scrp_arbeitsagentur_jobs_v2');
        
    } catch (error) {
        console.error('❌ Normalized table creation failed:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = NormalizedTableCreator;