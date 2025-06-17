const fs = require('fs');
const path = require('path');

// Files with corrupted table names that need fixing
const corruptedFiles = [
    'src/worker-with-batch.js',
    'src/batch-allocator.js',
    'src/parallel-keyword-scraper.js',
    'src/create-improved-table.js',
    'src/create-normalized-tables.js',
    'src/domain-email-extractor.js',
    'src/email-search-interface.js',
    'src/employer-optimized-scraper.js',
    'src/enhanced-intelligent-scraper.js',
    'src/fix-table-structure.js',
    'src/historical-employer-scraper.js',
    'src/intelligent-api-scraper.js',
    'src/keyword-domain-scraper-with-lock.js',
    'src/keyword-domain-scraper.js',
    'src/migrate-job-details.js',
    'src/migrate-legacy-data.js',
    'src/newest-jobs-scraper.js',
    'src/normalize-data.js',
    'src/puppeteer-domain-email-extractor.js',
    'src/setup-database.js',
    'src/setup-job-details-table.js',
    'src/simple-email-server.js',
    'src/simplified-detail-scraper.js',
    'complete-employer-linking.js',
    'create-employers.js',
    'extract-specific-jobs.js',
    'fix-email-extraction.js',
    'dashboard/server.js',
    'scrape-newest-jobs.js',
    'import-existing-emails.js',
    'scrape-newest-employers.js',
    'test-interface-startup.js',
    'run-continuous-scan.js',
    'update-background-scan.js',
    'run-focused-scan.js',
    'run-initial-28day-scan.js'
];

function fixTableNamesInFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${filePath}`);
        return false;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = false;
    
    // Fix corrupted table names by removing the number prefix
    const corruptedPatterns = [
        // Pattern: number + job_scrp_table_name
        /(\d+)job_scrp_(arbeitsagentur_jobs_v2|job_details|employers|domain_analysis)/g
    ];
    
    for (const pattern of corruptedPatterns) {
        if (pattern.test(content)) {
            content = content.replace(pattern, 'job_scrp_$2');
            updated = true;
        }
    }
    
    if (updated) {
        fs.writeFileSync(filePath, content);
        console.log(`✅ Fixed corrupted table names in: ${filePath}`);
        return true;
    } else {
        console.log(`📝 No corrupted table names found in: ${filePath}`);
        return false;
    }
}

console.log('🔧 Fixing corrupted table names...\n');

let totalFixed = 0;
let totalProcessed = 0;

for (const file of corruptedFiles) {
    const filePath = path.resolve(__dirname, file);
    totalProcessed++;
    
    if (fixTableNamesInFile(filePath)) {
        totalFixed++;
    }
}

console.log(`\n📊 Summary:`);
console.log(`   • Files processed: ${totalProcessed}`);
console.log(`   • Files fixed: ${totalFixed}`);
console.log(`   • Files unchanged: ${totalProcessed - totalFixed}`);

if (totalFixed > 0) {
    console.log(`\n✅ Table names fixed successfully`);
    console.log(`🔧 All table names now use correct job_scrp_ prefix`);
} else {
    console.log(`\n✨ No corrupted table names found`);
}