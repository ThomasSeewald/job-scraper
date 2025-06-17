const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class ImprovedTableCreator {
    
    async createJobsTableV2() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS job_scrp_arbeitsagentur_jobs_v2 (
                id SERIAL PRIMARY KEY,
                
                -- API-native field names (JSON-kompatibel)
                refnr VARCHAR(50) UNIQUE NOT NULL,  -- API: refnr
                titel VARCHAR(500),                  -- API: titel  
                beruf VARCHAR(200),                  -- API: beruf
                arbeitgeber VARCHAR(300),            -- API: arbeitgeber
                
                -- Arbeitsort (structured, nicht als JSON-String)
                arbeitsort_plz VARCHAR(5),           -- API: arbeitsort.plz
                arbeitsort_ort VARCHAR(100),         -- API: arbeitsort.ort
                arbeitsort_region VARCHAR(100),      -- API: arbeitsort.region
                arbeitsort_strasse VARCHAR(200),     -- API: arbeitsort.strasse
                arbeitsort_land VARCHAR(50),         -- API: arbeitsort.land
                arbeitsort_koordinaten_lat DOUBLE PRECISION,  -- API: arbeitsort.koordinaten.lat
                arbeitsort_koordinaten_lon DOUBLE PRECISION,  -- API: arbeitsort.koordinaten.lon
                arbeitsort_entfernung INTEGER,      -- API: arbeitsort.entfernung
                
                -- API Zeitfelder
                aktuelleVeroeffentlichungsdatum DATE,     -- API: aktuelleVeroeffentlichungsdatum
                eintrittsdatum DATE,                      -- API: eintrittsdatum
                modifikationsTimestamp TIMESTAMP,         -- API: modifikationsTimestamp
                
                -- API URLs/Referenzen
                externeUrl TEXT,                          -- API: externeUrl
                kundennummerHash VARCHAR(100),            -- API: kundennummerHash
                
                -- ZUSÄTZLICHE SCRAPING-DATEN (aus alter Tabelle)
                email VARCHAR(200),                       -- Gescrapte Email
                new_email VARCHAR(200),                   -- Alternative Email
                website TEXT,                             -- Gescrapte Website  
                new_website TEXT,                         -- Alternative Website
                
                -- Legacy-Felder aus alter Tabelle (falls vorhanden)
                work_location JSONB,                      -- Original work_location JSON
                legacy_data JSONB,                        -- Weitere Felder aus alter Tabelle
                
                -- API Rohdaten
                raw_api_response JSONB,                   -- Komplette API-Antwort
                api_query_params JSONB,                   -- Query-Parameter für API-Call
                
                -- Metadaten
                data_source VARCHAR(50) DEFAULT 'api',    -- 'api', 'scraping', 'migration'
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                
                -- Constraints
                CONSTRAINT unique_refnr UNIQUE(refnr)
            );
        `;
        
        const client = await pool.connect();
        try {
            await client.query(createTableSQL);
            console.log('✅ Improved table job_scrp_arbeitsagentur_jobs_v2 created');
            await this.createIndexesV2(client);
        } finally {
            client.release();
        }
    }
    
    async createIndexesV2(client) {
        const indexes = [
            // API-native Feldnamen
            'CREATE INDEX IF NOT EXISTS idx_v2_refnr ON job_scrp_arbeitsagentur_jobs_v2(refnr)',
            'CREATE INDEX IF NOT EXISTS idx_v2_arbeitgeber ON job_scrp_arbeitsagentur_jobs_v2(arbeitgeber)',
            'CREATE INDEX IF NOT EXISTS idx_v2_beruf ON job_scrp_arbeitsagentur_jobs_v2(beruf)',
            'CREATE INDEX IF NOT EXISTS idx_v2_arbeitsort_plz ON job_scrp_arbeitsagentur_jobs_v2(arbeitsort_plz)',
            'CREATE INDEX IF NOT EXISTS idx_v2_arbeitsort_ort ON job_scrp_arbeitsagentur_jobs_v2(arbeitsort_ort)',
            
            // Scraping-Daten
            'CREATE INDEX IF NOT EXISTS idx_v2_email ON job_scrp_arbeitsagentur_jobs_v2(email)',
            'CREATE INDEX IF NOT EXISTS idx_v2_website ON job_scrp_arbeitsagentur_jobs_v2(website)',
            
            // Zeitfelder
            'CREATE INDEX IF NOT EXISTS idx_v2_veroeffentlichung ON job_scrp_arbeitsagentur_jobs_v2(aktuelleVeroeffentlichungsdatum)',
            'CREATE INDEX IF NOT EXISTS idx_v2_scraped_at ON job_scrp_arbeitsagentur_jobs_v2(scraped_at)',
            
            // JSON-Felder
            'CREATE INDEX IF NOT EXISTS idx_v2_raw_api_gin ON job_scrp_arbeitsagentur_jobs_v2 USING GIN(raw_api_response)',
            'CREATE INDEX IF NOT EXISTS idx_v2_legacy_gin ON job_scrp_arbeitsagentur_jobs_v2 USING GIN(legacy_data)',
            
            // Compound-Indexes für häufige Abfragen
            'CREATE INDEX IF NOT EXISTS idx_v2_plz_email ON job_scrp_arbeitsagentur_jobs_v2(arbeitsort_plz, email)',
            'CREATE INDEX IF NOT EXISTS idx_v2_source_active ON job_scrp_arbeitsagentur_jobs_v2(data_source, is_active)'
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
    
    async analyzeOldTable() {
        const client = await pool.connect();
        try {
            // Datenqualitäts-Analyse der alten Tabelle
            const queries = [
                "SELECT COUNT(*) as total_records FROM our_sql_employment_agency",
                "SELECT COUNT(*) as with_email FROM our_sql_employment_agency WHERE email IS NOT NULL AND email != '' AND email != 'keine'",
                "SELECT COUNT(*) as with_new_email FROM our_sql_employment_agency WHERE new_email IS NOT NULL AND new_email != '' AND new_email != 'keine'",
                "SELECT COUNT(*) as with_website FROM our_sql_employment_agency WHERE website IS NOT NULL AND website != '' AND website != 'keine'",
                "SELECT COUNT(*) as with_new_website FROM our_sql_employment_agency WHERE new_website IS NOT NULL AND new_website != '' AND new_website != 'keine'",
                "SELECT COUNT(*) as with_reference_number FROM our_sql_employment_agency WHERE reference_number IS NOT NULL AND reference_number != ''",
                "SELECT COUNT(DISTINCT reference_number) as unique_references FROM our_sql_employment_agency WHERE reference_number IS NOT NULL"
            ];
            
            console.log('\n📊 OLD TABLE ANALYSIS:');
            console.log('=====================');
            
            for (const query of queries) {
                const result = await client.query(query);
                const key = query.match(/as (\w+)/)[1];
                const value = parseInt(result.rows[0][key]);
                console.log(`${key}: ${value.toLocaleString()}`);
            }
            
            // Sample der work_location JSON-Struktur
            const sampleQuery = `
                SELECT reference_number, employer, work_location, email, new_email, website, new_website
                FROM our_sql_employment_agency 
                WHERE work_location IS NOT NULL 
                AND (email IS NOT NULL OR website IS NOT NULL)
                LIMIT 3
            `;
            
            const samples = await client.query(sampleQuery);
            console.log('\n📋 SAMPLE DATA:');
            console.log('===============');
            samples.rows.forEach((row, i) => {
                console.log(`\nSample ${i+1}:`);
                console.log(`Reference: ${row.reference_number}`);
                console.log(`Employer: ${row.employer}`);
                console.log(`Work Location: ${row.work_location}`);
                console.log(`Email: ${row.email}`);
                console.log(`New Email: ${row.new_email}`);
                console.log(`Website: ${row.website}`);
                console.log(`New Website: ${row.new_website}`);
            });
            
        } finally {
            client.release();
        }
    }
}

async function main() {
    const creator = new ImprovedTableCreator();
    
    try {
        console.log('🔍 Analyzing old table structure...');
        await creator.analyzeOldTable();
        
        console.log('\n🏗️ Creating improved table structure...');
        await creator.createJobsTableV2();
        
        console.log('\n✅ Analysis and improved table creation completed!');
        
    } catch (error) {
        console.error('❌ Process failed:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = ImprovedTableCreator;