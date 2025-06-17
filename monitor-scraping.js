const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

async function monitorScraping() {
    console.clear();
    console.log('🔍 Real-time Scraping Monitor');
    console.log('=' . repeat(80));
    
    const client = await pool.connect();
    try {
        // Get scraping activity from last 5 minutes
        const activityQuery = `
            SELECT 
                e.id,
                e.name,
                e.email_extraction_date,
                e.contact_emails,
                e.best_email,
                e.website,
                e.has_emails,
                e.notes,
                EXTRACT(EPOCH FROM (NOW() - e.email_extraction_date)) as seconds_ago
            FROM job_scrp_employers e
            WHERE e.email_extraction_date > NOW() - INTERVAL '5 minutes'
            ORDER BY e.email_extraction_date DESC
            LIMIT 20
        `;
        
        const result = await client.query(activityQuery);
        
        // Get statistics
        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 minute') as last_minute,
                COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '5 minutes') as last_5_minutes,
                COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 hour') as last_hour,
                COUNT(*) FILTER (WHERE has_emails = true AND email_extraction_date > NOW() - INTERVAL '1 hour') as with_emails_last_hour,
                COUNT(*) FILTER (WHERE contact_emails IS NOT NULL AND contact_emails != '') as total_with_emails
            FROM job_scrp_employers
        `;
        
        const stats = await client.query(statsQuery);
        const s = stats.rows[0];
        
        // Display statistics
        console.log('\n📊 Statistics:');
        console.log(`   Last minute: ${s.last_minute} employers processed`);
        console.log(`   Last 5 minutes: ${s.last_5_minutes} employers processed`);
        console.log(`   Last hour: ${s.last_hour} employers processed`);
        console.log(`   Success rate (last hour): ${s.last_hour > 0 ? Math.round(s.with_emails_last_hour / s.last_hour * 100) : 0}%`);
        console.log(`   Total employers with emails: ${s.total_with_emails}`);
        
        // Display recent activity
        console.log('\n📋 Recent Activity:');
        console.log('-'.repeat(80));
        
        if (result.rows.length === 0) {
            console.log('   No activity in the last 5 minutes');
        } else {
            result.rows.forEach(row => {
                const timeAgo = Math.round(row.seconds_ago);
                const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.round(timeAgo/60)}m ago`;
                const status = row.has_emails ? '✅' : '❌';
                const emails = row.contact_emails || row.best_email || 'No emails';
                const emailStr = emails.length > 50 ? emails.substring(0, 50) + '...' : emails;
                
                console.log(`   ${status} [${timeStr.padEnd(8)}] ${row.name.padEnd(40).substring(0, 40)} | ${emailStr}`);
            });
        }
        
        console.log('\n🔄 Updates every 5 seconds... (Ctrl+C to exit)');
        
    } finally {
        client.release();
    }
}

// Run monitor every 5 seconds
async function startMonitor() {
    while (true) {
        await monitorScraping();
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Monitoring stopped');
    pool.end();
    process.exit(0);
});

// Start monitoring
startMonitor().catch(err => {
    console.error('Monitor error:', err);
    pool.end();
    process.exit(1);
});