const LegacyDataMigrator = require('./src/migrate-legacy-data');

async function runFullMigration() {
    const migrator = new LegacyDataMigrator();
    
    console.log('🚀 STARTING FULL MIGRATION OF 380K+ RECORDS');
    console.log('============================================');
    console.log('This will take approximately 10-15 minutes on Mac M4');
    console.log('Processing in batches of 1000 records...\n');
    
    try {
        // Run full migration with optimized batch size for Mac M4
        await migrator.migrateInBatches(2000); // Larger batches for better performance
        
        console.log('\n🎉 FULL MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('All legacy employment data with valuable email/website info has been migrated.');
        
    } catch (error) {
        console.error('❌ Full migration failed:', error.message);
        console.error('You can restart the migration - it will skip already migrated records.');
    }
}

runFullMigration();