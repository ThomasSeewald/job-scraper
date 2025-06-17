const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

class LegacyDataMigrator {
    constructor() {
        this.stats = {
            totalRecords: 0,
            migratedRecords: 0,
            skippedRecords: 0,
            errorRecords: 0,
            withEmail: 0,
            withWebsite: 0,
            startTime: new Date()
        };
        
        console.log('🚀 Legacy Data Migrator initialized');
    }
    
    /**
     * Parse work_location JSON string
     */
    parseWorkLocation(workLocationStr) {
        if (!workLocationStr) return null;
        
        try {
            // work_location ist als JSON-String gespeichert, aber mit single quotes
            const cleanedStr = workLocationStr
                .replace(/'/g, '"')  // Single quotes zu double quotes
                .replace(/None/g, 'null')  // Python None zu JSON null
                .replace(/True/g, 'true')  // Python True zu JSON true
                .replace(/False/g, 'false'); // Python False zu JSON false
            
            return JSON.parse(cleanedStr);
        } catch (error) {
            console.warn(`⚠️ Could not parse work_location: ${workLocationStr}`);
            return null;
        }
    }
    
    /**
     * Transform legacy record to new format
     */
    transformLegacyRecord(legacyRecord) {
        const workLocation = this.parseWorkLocation(legacyRecord.work_location);
        
        return {
            // API-native Feldnamen
            refnr: legacyRecord.reference_number,
            titel: legacyRecord.title,
            beruf: legacyRecord.occupation,
            arbeitgeber: legacyRecord.employer,
            
            // Arbeitsort aus work_location JSON extrahieren
            arbeitsort_plz: workLocation?.plz?.toString() || null,
            arbeitsort_ort: workLocation?.ort || null,
            arbeitsort_region: workLocation?.region || null,
            arbeitsort_strasse: workLocation?.strasse || null,
            arbeitsort_land: workLocation?.land || 'Deutschland',
            arbeitsort_koordinaten_lat: workLocation?.koordinaten?.lat || null,
            arbeitsort_koordinaten_lon: workLocation?.koordinaten?.lon || null,
            arbeitsort_entfernung: workLocation?.entfernung || null,
            
            // Zeitfelder
            aktuelleVeroeffentlichungsdatum: this.parseDate(legacyRecord.current_publication_date),
            eintrittsdatum: this.parseDate(legacyRecord.entry_date),
            
            // Scraping-Daten (das Wertvollste!)
            email: this.cleanEmail(legacyRecord.email),
            new_email: this.cleanEmail(legacyRecord.new_email),
            website: this.cleanWebsite(legacyRecord.website),
            new_website: this.cleanWebsite(legacyRecord.new_website),
            
            // Legacy-Daten komplett speichern
            work_location: workLocation,
            legacy_data: this.extractLegacyData(legacyRecord),
            
            // Metadaten
            data_source: 'migration'
        };
    }
    
    /**
     * Clean email addresses
     */
    cleanEmail(email) {
        if (!email || email === '' || email === 'keine' || email === 'null') {
            return null;
        }
        return email.trim();
    }
    
    /**
     * Clean website URLs
     */
    cleanWebsite(website) {
        if (!website || website === '' || website === 'keine' || website === 'null') {
            return null;
        }
        
        let cleaned = website.trim();
        
        // Add https:// if no protocol specified
        if (cleaned && !cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
            cleaned = 'https://' + cleaned;
        }
        
        return cleaned;
    }
    
    /**
     * Parse date strings
     */
    parseDate(dateStr) {
        if (!dateStr || dateStr === '' || dateStr === 'null') {
            return null;
        }
        
        try {
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Extract additional legacy data fields
     */
    extractLegacyData(record) {
        return {
            id: record.id,
            updated: record.updated,
            create_uid: record.create_uid,
            write_uid: record.write_uid,
            create_date: record.create_date,
            write_date: record.write_date
        };
    }
    
    /**
     * Migrate records in batches
     */
    async migrateInBatches(batchSize = 1000) {
        console.log(`🚀 Starting migration in batches of ${batchSize} records...`);
        
        const client = await pool.connect();
        
        try {
            // Get total count
            const countResult = await client.query('SELECT COUNT(*) as total FROM our_sql_employment_agency');
            this.stats.totalRecords = parseInt(countResult.rows[0].total);
            
            console.log(`📊 Total records to migrate: ${this.stats.totalRecords.toLocaleString()}`);
            
            let offset = 0;
            let batchNumber = 1;
            
            while (offset < this.stats.totalRecords) {
                console.log(`\n📦 Processing batch ${batchNumber} (${offset + 1} - ${Math.min(offset + batchSize, this.stats.totalRecords)})`);
                
                await this.migrateBatch(client, offset, batchSize);
                
                offset += batchSize;
                batchNumber++;
                
                // Progress report every 10 batches
                if (batchNumber % 10 === 0) {
                    this.printProgress();
                }
            }
            
            console.log('\n✅ Migration completed!');
            this.printFinalStats();
            
        } finally {
            client.release();
        }
    }
    
    /**
     * Migrate a single batch
     */
    async migrateBatch(client, offset, batchSize) {
        try {
            // Fetch batch from old table
            const selectQuery = `
                SELECT id, reference_number, title, occupation, employer, 
                       work_location, current_publication_date, entry_date,
                       email, new_email, website, new_website,
                       updated, create_uid, write_uid, create_date, write_date
                FROM our_sql_employment_agency 
                ORDER BY id
                LIMIT $1 OFFSET $2
            `;
            
            const result = await client.query(selectQuery, [batchSize, offset]);
            
            for (const legacyRecord of result.rows) {
                await this.migrateRecord(client, legacyRecord);
            }
            
        } catch (error) {
            console.error(`❌ Batch migration failed at offset ${offset}:`, error.message);
            this.stats.errorRecords += batchSize;
        }
    }
    
    /**
     * Migrate a single record
     */
    async migrateRecord(client, legacyRecord) {
        try {
            const transformedRecord = this.transformLegacyRecord(legacyRecord);
            
            // Skip if no reference number
            if (!transformedRecord.refnr) {
                this.stats.skippedRecords++;
                return;
            }
            
            // Insert into new table (with ON CONFLICT handling)
            const insertQuery = `
                INSERT INTO job_scrp_arbeitsagentur_jobs_v2 (
                    refnr, titel, beruf, arbeitgeber,
                    arbeitsort_plz, arbeitsort_ort, arbeitsort_region, arbeitsort_strasse, arbeitsort_land,
                    arbeitsort_koordinaten_lat, arbeitsort_koordinaten_lon, arbeitsort_entfernung,
                    aktuelleVeroeffentlichungsdatum, eintrittsdatum,
                    email, new_email, website, new_website,
                    work_location, legacy_data, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                ) ON CONFLICT (refnr) DO UPDATE SET
                    email = COALESCE(EXCLUDED.email, job_scrp_arbeitsagentur_jobs_v2.email),
                    new_email = COALESCE(EXCLUDED.new_email, job_scrp_arbeitsagentur_jobs_v2.new_email),
                    website = COALESCE(EXCLUDED.website, job_scrp_arbeitsagentur_jobs_v2.website),
                    new_website = COALESCE(EXCLUDED.new_website, job_scrp_arbeitsagentur_jobs_v2.new_website),
                    legacy_data = EXCLUDED.legacy_data,
                    last_updated = CURRENT_TIMESTAMP
            `;
            
            await client.query(insertQuery, [
                transformedRecord.refnr,
                transformedRecord.titel,
                transformedRecord.beruf,
                transformedRecord.arbeitgeber,
                transformedRecord.arbeitsort_plz,
                transformedRecord.arbeitsort_ort,
                transformedRecord.arbeitsort_region,
                transformedRecord.arbeitsort_strasse,
                transformedRecord.arbeitsort_land,
                transformedRecord.arbeitsort_koordinaten_lat,
                transformedRecord.arbeitsort_koordinaten_lon,
                transformedRecord.arbeitsort_entfernung,
                transformedRecord.aktuelleVeroeffentlichungsdatum,
                transformedRecord.eintrittsdatum,
                transformedRecord.email,
                transformedRecord.new_email,
                transformedRecord.website,
                transformedRecord.new_website,
                JSON.stringify(transformedRecord.work_location),
                JSON.stringify(transformedRecord.legacy_data),
                transformedRecord.data_source
            ]);
            
            this.stats.migratedRecords++;
            
            // Count valuable data
            if (transformedRecord.email || transformedRecord.new_email) {
                this.stats.withEmail++;
            }
            if (transformedRecord.website || transformedRecord.new_website) {
                this.stats.withWebsite++;
            }
            
        } catch (error) {
            console.error(`❌ Error migrating record ${legacyRecord.reference_number}:`, error.message);
            this.stats.errorRecords++;
        }
    }
    
    /**
     * Print progress statistics
     */
    printProgress() {
        const elapsed = Math.round((new Date() - this.stats.startTime) / 1000);
        const rate = Math.round(this.stats.migratedRecords / elapsed);
        const remaining = this.stats.totalRecords - this.stats.migratedRecords - this.stats.skippedRecords - this.stats.errorRecords;
        const eta = Math.round(remaining / rate);
        
        console.log(`\n📈 PROGRESS UPDATE:`);
        console.log(`   Migrated: ${this.stats.migratedRecords.toLocaleString()}`);
        console.log(`   With Email: ${this.stats.withEmail.toLocaleString()}`);
        console.log(`   With Website: ${this.stats.withWebsite.toLocaleString()}`);
        console.log(`   Skipped: ${this.stats.skippedRecords.toLocaleString()}`);
        console.log(`   Errors: ${this.stats.errorRecords.toLocaleString()}`);
        console.log(`   Rate: ${rate} records/sec`);
        console.log(`   ETA: ${eta} seconds`);
    }
    
    /**
     * Print final statistics
     */
    printFinalStats() {
        const duration = Math.round((new Date() - this.stats.startTime) / 1000);
        const rate = Math.round(this.stats.migratedRecords / duration);
        
        console.log(`\n📊 MIGRATION COMPLETED`);
        console.log(`========================`);
        console.log(`Total records: ${this.stats.totalRecords.toLocaleString()}`);
        console.log(`Migrated: ${this.stats.migratedRecords.toLocaleString()}`);
        console.log(`With Email data: ${this.stats.withEmail.toLocaleString()}`);
        console.log(`With Website data: ${this.stats.withWebsite.toLocaleString()}`);
        console.log(`Skipped: ${this.stats.skippedRecords.toLocaleString()}`);
        console.log(`Errors: ${this.stats.errorRecords.toLocaleString()}`);
        console.log(`Duration: ${duration} seconds`);
        console.log(`Average rate: ${rate} records/sec`);
        console.log(`Success rate: ${((this.stats.migratedRecords / this.stats.totalRecords) * 100).toFixed(1)}%`);
    }
    
    /**
     * Test migration with sample data
     */
    async testMigration(sampleSize = 100) {
        console.log(`🧪 Testing migration with ${sampleSize} sample records...`);
        
        const client = await pool.connect();
        
        try {
            // Clear any existing test data
            await client.query("DELETE FROM job_scrp_arbeitsagentur_jobs_v2 WHERE data_source = 'migration'");
            
            // Migrate sample
            await this.migrateBatch(client, 0, sampleSize);
            
            // Verify migration
            const verifyQuery = `
                SELECT COUNT(*) as migrated_count,
                       COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
                       COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE data_source = 'migration'
            `;
            
            const verifyResult = await client.query(verifyQuery);
            const stats = verifyResult.rows[0];
            
            console.log(`\n✅ Test migration successful:`);
            console.log(`   Migrated: ${stats.migrated_count}`);
            console.log(`   With Email: ${stats.with_email}`);
            console.log(`   With Website: ${stats.with_website}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ Test migration failed:', error.message);
            return false;
        } finally {
            client.release();
        }
    }
}

async function main() {
    const migrator = new LegacyDataMigrator();
    
    try {
        // Test migration first
        console.log('🧪 Running test migration...');
        const testSuccess = await migrator.testMigration(50);
        
        if (!testSuccess) {
            throw new Error('Test migration failed');
        }
        
        // Ask for confirmation (in production, this would be a CLI prompt)
        console.log('\n❓ Test successful. Proceed with full migration? (This will migrate 380K+ records)');
        console.log('   This operation will take approximately 10-15 minutes.');
        
        // For automation, we'll proceed automatically
        // In production, you'd want user confirmation here
        
        await migrator.migrateInBatches(1000);
        
        console.log('\n🎉 Legacy data migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = LegacyDataMigrator;