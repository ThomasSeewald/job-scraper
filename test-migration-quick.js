const LegacyDataMigrator = require('./src/migrate-legacy-data');

async function quickTest() {
    const migrator = new LegacyDataMigrator();
    
    console.log('🧪 Quick migration test with corrected table structure...');
    
    // Test mit nur 10 Records um schnell zu verifizieren
    try {
        const testSuccess = await migrator.testMigration(10);
        
        if (testSuccess) {
            console.log('\n✅ Quick test successful! Table structure is now compatible.');
            console.log('Ready to proceed with full migration of 380K+ records.');
        } else {
            console.log('\n❌ Quick test failed. Need to investigate further.');
        }
        
    } catch (error) {
        console.error('❌ Quick test error:', error.message);
    }
}

quickTest();