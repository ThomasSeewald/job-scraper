const DailyFreshScanner = require('./daily-fresh-scanner');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

/**
 * Test the Daily Fresh Scanner with just a few PLZ
 */
async function testDailyFreshScanner() {
    console.log('🧪 Testing Daily Fresh Scanner (limited to 5 PLZ)');
    console.log('==================================================');
    
    try {
        // Get just first 5 PLZ for testing
        const client = await pool.connect();
        const result = await client.query(`
            SELECT postal_code, city, latitude, longitude
            FROM our_sql_postal_code 
            WHERE postal_code IS NOT NULL 
            AND LENGTH(postal_code) = 5
            ORDER BY postal_code ASC
            LIMIT 5
        `);
        client.release();
        
        console.log(`📋 Testing with ${result.rows.length} postal codes:`);
        result.rows.forEach(plz => console.log(`   ${plz.postal_code} (${plz.city})`));
        
        // Create a modified scanner for testing
        const scanner = new DailyFreshScanner();
        
        // Override the getAllPostalCodes method for testing
        scanner.getAllPostalCodes = async () => result.rows;
        
        console.log('\n🚀 Starting test scan...');
        await scanner.runDailyFreshScan();
        
        console.log('\n✅ Test completed successfully!');
        console.log('📊 Check daily-fresh.log for detailed results');
        console.log('📈 Check plz-performance.json for PLZ performance data');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await pool.end();
    }
}

testDailyFreshScanner();