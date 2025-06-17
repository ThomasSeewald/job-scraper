// This script adds a real-time activity route to the combined dashboard
const fs = require('fs');
const path = require('path');

// Read the current combined-dashboard.js
const dashboardPath = path.join(__dirname, 'src/combined-dashboard.js');
const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

// Find where to insert the new route (after the email-search route)
const insertPoint = dashboardContent.indexOf('// Health check endpoint');

if (insertPoint === -1) {
    console.error('Could not find insertion point in combined-dashboard.js');
    process.exit(1);
}

// The new route to add
const newRoute = `
// Real-time scraping activity route
app.get('/scraping-activity', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get recent scraping activity (last 10 minutes)
            const activityQuery = \`
                SELECT 
                    e.id,
                    e.name,
                    e.email_extraction_date,
                    e.contact_emails,
                    e.best_email,
                    e.website,
                    e.company_domain,
                    e.has_emails,
                    e.notes,
                    e.email_extraction_attempted,
                    EXTRACT(EPOCH FROM (NOW() - e.email_extraction_date)) as seconds_ago,
                    TO_CHAR(e.email_extraction_date, 'HH24:MI:SS') as time_extracted
                FROM job_scrp_employers e
                WHERE e.email_extraction_date > NOW() - INTERVAL '10 minutes'
                ORDER BY e.email_extraction_date DESC
                LIMIT 100
            \`;
            
            const result = await client.query(activityQuery);
            
            // Get statistics
            const statsQuery = \`
                SELECT 
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 minute') as last_minute,
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '5 minutes') as last_5_minutes,
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 hour') as last_hour,
                    COUNT(*) FILTER (WHERE has_emails = true AND email_extraction_date > NOW() - INTERVAL '1 hour') as with_emails_last_hour,
                    COUNT(*) FILTER (WHERE contact_emails IS NOT NULL AND contact_emails != '') as total_with_emails,
                    COUNT(*) FILTER (WHERE email_extraction_attempted = true) as total_attempted
                FROM job_scrp_employers
            \`;
            
            const stats = await client.query(statsQuery);
            
            // Render the activity page
            res.send(\`
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-time Scraping Activity</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        .activity-row { font-size: 0.9em; }
        .email-cell { font-family: monospace; font-size: 0.85em; }
        .success-badge { background-color: #28a745; }
        .no-email-badge { background-color: #ffc107; color: #000; }
        .error-badge { background-color: #dc3545; }
        .stats-card { border-left: 4px solid #007bff; }
        .refresh-notice { position: fixed; top: 10px; right: 10px; }
        .field-label { font-weight: bold; color: #6c757d; }
        .field-value { color: #212529; }
    </style>
</head>
<body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container-fluid">
            <a class="navbar-brand" href="/">Job Scraper Dashboard</a>
            <div class="navbar-nav ms-auto">
                <a class="nav-link" href="/">Main Dashboard</a>
                <a class="nav-link" href="/email-search">Email Search</a>
                <a class="nav-link active" href="/scraping-activity">Scraping Activity</a>
            </div>
        </div>
    </nav>

    <div class="container-fluid mt-3">
        <h2>🔍 Real-time Scraping Activity</h2>
        
        <div class="refresh-notice">
            <span class="badge bg-info">Auto-refresh: 5s</span>
        </div>
        
        <!-- Statistics Cards -->
        <div class="row mt-4">
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Last Minute</h6>
                        <h3 class="card-title">\${stats.rows[0].last_minute}</h3>
                    </div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Last 5 Minutes</h6>
                        <h3 class="card-title">\${stats.rows[0].last_5_minutes}</h3>
                    </div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Last Hour</h6>
                        <h3 class="card-title">\${stats.rows[0].last_hour}</h3>
                    </div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Success Rate</h6>
                        <h3 class="card-title">\${stats.rows[0].last_hour > 0 ? Math.round(stats.rows[0].with_emails_last_hour / stats.rows[0].last_hour * 100) : 0}%</h3>
                    </div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Total with Emails</h6>
                        <h3 class="card-title">\${stats.rows[0].total_with_emails.toLocaleString()}</h3>
                    </div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card stats-card">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2 text-muted">Total Attempted</h6>
                        <h3 class="card-title">\${stats.rows[0].total_attempted.toLocaleString()}</h3>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Activity Table -->
        <div class="mt-4">
            <h4>📋 Recent Activity (Last 10 Minutes)</h4>
            <div class="table-responsive">
                <table class="table table-sm table-hover">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Employer Name</th>
                            <th>Status</th>
                            <th>contact_emails</th>
                            <th>best_email</th>
                            <th>website</th>
                            <th>company_domain</th>
                            <th>notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${result.rows.map(row => {
                            const timeAgo = Math.round(row.seconds_ago);
                            const timeStr = timeAgo < 60 ? \`\${timeAgo}s ago\` : \`\${Math.round(timeAgo/60)}m ago\`;
                            
                            let statusBadge = '';
                            if (row.has_emails) {
                                statusBadge = '<span class="badge success-badge">✓ Success</span>';
                            } else if (row.notes && row.notes.includes('Error')) {
                                statusBadge = '<span class="badge error-badge">✗ Error</span>';
                            } else {
                                statusBadge = '<span class="badge no-email-badge">No Email</span>';
                            }
                            
                            return \`
                                <tr class="activity-row">
                                    <td><small>\${timeStr}<br>\${row.time_extracted}</small></td>
                                    <td>\${row.name}</td>
                                    <td>\${statusBadge}</td>
                                    <td class="email-cell"><small>\${row.contact_emails || '-'}</small></td>
                                    <td class="email-cell"><small>\${row.best_email || '-'}</small></td>
                                    <td class="email-cell"><small>\${row.website || '-'}</small></td>
                                    <td class="email-cell"><small>\${row.company_domain || '-'}</small></td>
                                    <td><small>\${row.notes || '-'}</small></td>
                                </tr>
                            \`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>
            \`);
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Scraping activity error:', error);
        res.status(500).send('Error loading scraping activity');
    }
});

`;

// Insert the new route
const updatedContent = dashboardContent.slice(0, insertPoint) + newRoute + '\n' + dashboardContent.slice(insertPoint);

// Write the updated file
fs.writeFileSync(dashboardPath, updatedContent);

console.log('✅ Added /scraping-activity route to combined-dashboard.js');
console.log('📊 The new route will be available after restarting the server');