const fs = require('fs');
const path = require('path');

// Map of old table names to new prefixed names
const tableNameMap = {
    'arbeitsagentur_jobs_v2': 'job_scrp_arbeitsagentur_jobs_v2',
    'job_details': 'job_scrp_job_details',
    'employers': 'job_scrp_employers',
    'domain_analysis': 'job_scrp_domain_analysis'
};

// Files that need updating (from the search results)
const filesToUpdate = [
    // Dashboard files
    'dashboard/server.js',
    
    // Main source files
    'src/combined-dashboard.js',
    'src/email-search-interface.js',
    'src/employer-optimized-scraper.js',
    'src/enhanced-intelligent-scraper.js',
    'src/historical-employer-scraper.js',
    'src/create-improved-table.js',
    'src/fix-table-structure.js',
    'src/newest-jobs-scraper.js',
    'src/simplified-detail-scraper.js',
    'src/migrate-job-details.js',
    'src/intelligent-api-scraper.js',
    'src/normalize-data.js',
    'src/create-normalized-tables.js',
    'src/migrate-legacy-data.js',
    'src/simple-email-server.js',
    'src/setup-job-details-table.js',
    'src/puppeteer-domain-email-extractor.js',
    'src/setup-database.js',
    'src/domain-email-extractor.js',
    'src/batch-allocator.js',
    'src/parallel-keyword-scraper.js',
    'src/keyword-domain-scraper-with-lock.js',
    'src/worker-with-batch.js',
    'src/keyword-domain-scraper.js',
    
    // Root level files
    'complete-employer-linking.js',
    'scrape-newest-jobs.js',
    'import-existing-emails.js',
    'scrape-newest-employers.js',
    'test-interface-startup.js',
    'extract-specific-jobs.js',
    'fix-email-extraction.js',
    'test-enhanced-scraper.js',
    'create-employers.js',
    'run-continuous-scan.js',
    'update-background-scan.js',
    'run-focused-scan.js',
    'run-initial-28day-scan.js'
];

// Function to escape special regex characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Function to update table names in a file
function updateTableNamesInFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${filePath}`);
        return false;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = false;
    
    // Update each table name
    for (const [oldName, newName] of Object.entries(tableNameMap)) {
        // Create regex patterns to match table names in SQL contexts
        const patterns = [
            // Direct table name references
            new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g'),
            // Table names in quotes
            new RegExp(`"${escapeRegex(oldName)}"`, 'g'),
            new RegExp(`'${escapeRegex(oldName)}'`, 'g'),
            // Table names after FROM, JOIN, INTO, UPDATE, etc.
            new RegExp(`(FROM\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(JOIN\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(INTO\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(UPDATE\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(INSERT\\s+INTO\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(DELETE\\s+FROM\\s+)${escapeRegex(oldName)}\\b`, 'gi'),
            new RegExp(`(TABLE\\s+)${escapeRegex(oldName)}\\b`, 'gi')
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                content = content.replace(pattern, (match, prefix) => {
                    if (prefix) {
                        return prefix + newName;
                    }
                    return match.replace(oldName, newName);
                });
                updated = true;
            }
        }
    }
    
    if (updated) {
        // Create backup
        fs.writeFileSync(filePath + '.backup', fs.readFileSync(filePath));
        // Write updated content
        fs.writeFileSync(filePath, content);
        console.log(`✅ Updated: ${filePath}`);
        return true;
    } else {
        console.log(`📝 No changes needed: ${filePath}`);
        return false;
    }
}

// Main execution
console.log('🚀 Starting table name update process...\n');

let totalUpdated = 0;
let totalProcessed = 0;

for (const file of filesToUpdate) {
    const filePath = path.resolve(__dirname, file);
    totalProcessed++;
    
    if (updateTableNamesInFile(filePath)) {
        totalUpdated++;
    }
}

console.log(`\n📊 Summary:`);
console.log(`   • Files processed: ${totalProcessed}`);
console.log(`   • Files updated: ${totalUpdated}`);
console.log(`   • Files unchanged: ${totalProcessed - totalUpdated}`);

if (totalUpdated > 0) {
    console.log(`\n💾 Backup files created with .backup extension`);
    console.log(`🔧 Table names updated from old format to job_scrp_ prefix`);
} else {
    console.log(`\n✨ No files needed updating - all table references already correct`);
}