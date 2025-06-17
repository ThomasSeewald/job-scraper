const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const pool = new Pool(config.production);

const app = express();
const PORT = 3002; // Different port from main dashboard

// Main activity page
app.get('/', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get recent scraping activity (last 30 minutes)
            const activityQuery = `
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
                WHERE e.email_extraction_date > NOW() - INTERVAL '30 minutes'
                ORDER BY e.email_extraction_date DESC
                LIMIT 200
            `;
            
            const result = await client.query(activityQuery);
            
            // Get statistics
            const statsQuery = `
                SELECT 
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 minute') as last_minute,
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '5 minutes') as last_5_minutes,
                    COUNT(*) FILTER (WHERE email_extraction_date > NOW() - INTERVAL '1 hour') as last_hour,
                    COUNT(*) FILTER (WHERE has_emails = true AND email_extraction_date > NOW() - INTERVAL '1 hour') as with_emails_last_hour,
                    COUNT(*) FILTER (WHERE contact_emails IS NOT NULL AND contact_emails != '') as total_with_emails,
                    COUNT(*) FILTER (WHERE email_extraction_attempted = true) as total_attempted
                FROM job_scrp_employers
            `;
            
            const stats = await client.query(statsQuery);
            
            // Render the activity page
            res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-time Scraping Activity Monitor</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { font-size: 14px; }
        .activity-row { font-size: 0.9em; }
        .email-cell { font-family: monospace; font-size: 0.85em; word-break: break-all; }
        .success-badge { background-color: #28a745; }
        .no-email-badge { background-color: #ffc107; color: #000; }
        .error-badge { background-color: #dc3545; }
        .stats-card { 
            border-left: 4px solid #007bff; 
            height: 100%;
            transition: transform 0.2s;
        }
        .stats-card:hover { transform: translateY(-2px); }
        .refresh-notice { 
            position: fixed; 
            top: 10px; 
            right: 10px; 
            z-index: 1000;
        }
        .field-header { 
            font-weight: bold; 
            background-color: #f8f9fa;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .table-container {
            max-height: 70vh;
            overflow-y: auto;
        }
        .highlight-new {
            animation: highlight 2s ease-out;
        }
        @keyframes highlight {
            from { background-color: #fff3cd; }
            to { background-color: transparent; }
        }
        .nav-links {
            background-color: #343a40;
            padding: 10px 0;
            margin-bottom: 20px;
        }
        .nav-links a {
            color: white;
            margin: 0 15px;
            text-decoration: none;
        }
        .nav-links a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="nav-links text-center">
        <a href="http://localhost:3001">← Main Dashboard</a>
        <span class="text-white">|</span>
        <a href="http://localhost:3001/email-search">Email Search</a>
        <span class="text-white">|</span>
        <strong class="text-warning">Scraping Activity Monitor</strong>
    </div>

    <div class="container-fluid">
        <h2 class="mb-4">🔍 Real-time Scraping Activity Monitor</h2>
        
        <div class="refresh-notice">
            <span class="badge bg-info">Auto-refresh: 5s</span>
        </div>
        
        <!-- Statistics Cards -->
        <div class="row mb-4">
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Last Minute</h6>
                        <h2 class="card-title text-primary">${stats.rows[0].last_minute}</h2>
                        <small class="text-muted">employers</small>
                    </div>
                </div>
            </div>
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Last 5 Minutes</h6>
                        <h2 class="card-title text-primary">${stats.rows[0].last_5_minutes}</h2>
                        <small class="text-muted">employers</small>
                    </div>
                </div>
            </div>
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Last Hour</h6>
                        <h2 class="card-title text-primary">${stats.rows[0].last_hour}</h2>
                        <small class="text-muted">employers</small>
                    </div>
                </div>
            </div>
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Success Rate</h6>
                        <h2 class="card-title text-success">${stats.rows[0].last_hour > 0 ? Math.round(stats.rows[0].with_emails_last_hour / stats.rows[0].last_hour * 100) : 0}%</h2>
                        <small class="text-muted">last hour</small>
                    </div>
                </div>
            </div>
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Total with Emails</h6>
                        <h2 class="card-title text-info">${stats.rows[0].total_with_emails.toLocaleString()}</h2>
                        <small class="text-muted">all time</small>
                    </div>
                </div>
            </div>
            <div class="col-md-2 mb-3">
                <div class="card stats-card">
                    <div class="card-body text-center">
                        <h6 class="card-subtitle mb-2 text-muted">Total Attempted</h6>
                        <h2 class="card-title text-secondary">${stats.rows[0].total_attempted.toLocaleString()}</h2>
                        <small class="text-muted">all time</small>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Activity Table -->
        <div>
            <h4 class="mb-3">📋 Database Fields Being Updated (Last 30 Minutes)</h4>
            <div class="table-container">
                <table class="table table-sm table-hover table-bordered">
                    <thead class="field-header">
                        <tr>
                            <th width="10%">Time</th>
                            <th width="20%">Employer Name</th>
                            <th width="8%">Status</th>
                            <th width="20%" class="text-primary">contact_emails</th>
                            <th width="15%" class="text-primary">best_email</th>
                            <th width="12%" class="text-primary">website</th>
                            <th width="10%" class="text-primary">company_domain</th>
                            <th width="15%" class="text-primary">notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.rows.map((row, index) => {
                            const timeAgo = Math.round(row.seconds_ago);
                            const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.round(timeAgo/60)}m ago`;
                            const isNew = timeAgo < 10;
                            
                            let statusBadge = '';
                            if (row.has_emails) {
                                statusBadge = '<span class="badge success-badge">✓ Success</span>';
                            } else if (row.notes && row.notes.includes('Error')) {
                                statusBadge = '<span class="badge error-badge">✗ Error</span>';
                            } else {
                                statusBadge = '<span class="badge no-email-badge">No Email</span>';
                            }
                            
                            // Truncate long values for display
                            const truncate = (str, len) => {
                                if (!str) return '-';
                                return str.length > len ? str.substring(0, len) + '...' : str;
                            };
                            
                            return `
                                <tr class="activity-row ${isNew ? 'highlight-new' : ''}">
                                    <td><small>${timeStr}<br><code>${row.time_extracted}</code></small></td>
                                    <td title="${row.name}"><small>${truncate(row.name, 50)}</small></td>
                                    <td class="text-center">${statusBadge}</td>
                                    <td class="email-cell" title="${row.contact_emails || ''}"><small>${truncate(row.contact_emails, 60)}</small></td>
                                    <td class="email-cell" title="${row.best_email || ''}"><small>${truncate(row.best_email, 40)}</small></td>
                                    <td class="email-cell" title="${row.website || ''}"><small>${truncate(row.website, 30)}</small></td>
                                    <td class="email-cell"><small>${row.company_domain || '-'}</small></td>
                                    <td title="${row.notes || ''}"><small>${truncate(row.notes, 40)}</small></td>
                                </tr>
                            `;
                        }).join('') || '<tr><td colspan="8" class="text-center text-muted">No activity in the last 30 minutes</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="mt-4 text-muted">
            <small>
                <strong>Database Table:</strong> job_scrp_employers<br>
                <strong>Key Fields:</strong> contact_emails (comma-separated list), best_email (primary email), has_emails (boolean), email_extraction_date (timestamp)<br>
                <strong>Processing:</strong> 3 parallel scrapers running with visible browsers
            </small>
        </div>
    </div>

    <script>
        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
        
        // Highlight newest entries
        document.querySelectorAll('.activity-row').forEach(row => {
            if (row.classList.contains('highlight-new')) {
                setTimeout(() => row.classList.remove('highlight-new'), 2000);
            }
        });
    </script>
</body>
</html>
            `);
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Scraping activity error:', error);
        res.status(500).send('Error loading scraping activity');
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🔍 Scraping Activity Monitor running on http://localhost:${PORT}`);
    console.log('📊 Auto-refreshes every 5 seconds');
    console.log('🔗 Links to main dashboard at http://localhost:3001');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down activity monitor...');
    pool.end();
    process.exit(0);
});