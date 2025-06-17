const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const dbConfig = config.production;

const app = express();
const pool = new Pool(dbConfig);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Main dashboard route - EMPLOYERS ONLY
app.get('/', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get employer statistics
            const employerStatsQuery = `
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted_employers,
                    COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as employers_with_emails,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '1 hour' THEN 1 END) as processed_last_hour,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '24 hours' THEN 1 END) as processed_last_24_hours,
                    COUNT(CASE WHEN email_extraction_attempted = false THEN 1 END) as employers_never_scraped,
                    MAX(email_extraction_date) as last_extraction
                FROM job_scrp_employers
            `;
            const employerStats = await client.query(employerStatsQuery);

            // Get unique email statistics from employers
            const emailStatsQuery = `
                SELECT 
                    COUNT(DISTINCT TRIM(LOWER(email_addr))) as unique_emails
                FROM job_scrp_employers
                CROSS JOIN LATERAL unnest(string_to_array(contact_emails, ',')) AS email_addr
                WHERE contact_emails IS NOT NULL 
                    AND contact_emails != ''
                    AND TRIM(email_addr) != ''
            `;
            const emailStats = await client.query(emailStatsQuery);

            // Get jobs statistics
            const jobStatsQuery = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(DISTINCT arbeitgeber) as unique_employers,
                    COUNT(DISTINCT arbeitsort_plz) as unique_locations,
                    MAX(scraped_at) as last_scan
                FROM job_scrp_arbeitsagentur_jobs_v2
                WHERE is_active = true
            `;
            const jobStats = await client.query(jobStatsQuery);

            // Get recent employer extractions
            const recentEmployersQuery = `
                SELECT 
                    name,
                    contact_emails,
                    website,
                    job_count,
                    email_extraction_date
                FROM job_scrp_employers
                WHERE email_extraction_date IS NOT NULL
                ORDER BY email_extraction_date DESC
                LIMIT 20
            `;
            const recentEmployers = await client.query(recentEmployersQuery);

            // Render simplified dashboard
            const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Employer Scraping Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        .stat-card {
            border: 2px solid #dee2e6;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
            text-align: center;
        }
        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: #0d6efd;
        }
        .stat-label {
            color: #6c757d;
            font-size: 1.1rem;
        }
        .success-stat { border-color: #28a745; }
        .success-stat .stat-number { color: #28a745; }
        .warning-stat { border-color: #ffc107; }
        .warning-stat .stat-number { color: #ffc107; }
        #activity-monitor { border: 2px solid #0d6efd; }
        #activity-monitor .badge { min-width: 50px; }
        #activity-monitor small { font-size: 0.75rem; }
    </style>
</head>
<body>
    <nav class="navbar navbar-dark bg-dark mb-4">
        <div class="container">
            <span class="navbar-brand">🏢 Employer Extraction Dashboard</span>
            <span class="navbar-text">
                Last Update: ${new Date().toLocaleString('de-DE')}
            </span>
        </div>
    </nav>

    <div class="container">
        <!-- Main Statistics -->
        <div class="row">
            <div class="col-md-3">
                <div class="stat-card">
                    <div class="stat-number">${employerStats.rows[0].total_employers.toLocaleString('de-DE')}</div>
                    <div class="stat-label">Total Employers</div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stat-card success-stat">
                    <div class="stat-number">${employerStats.rows[0].employers_with_emails.toLocaleString('de-DE')}</div>
                    <div class="stat-label">With Email Addresses</div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stat-card warning-stat">
                    <div class="stat-number">${employerStats.rows[0].employers_never_scraped.toLocaleString('de-DE')}</div>
                    <div class="stat-label">Never Scraped</div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stat-card">
                    <div class="stat-number">${emailStats.rows[0].unique_emails.toLocaleString('de-DE')}</div>
                    <div class="stat-label">Unique Email Addresses</div>
                </div>
            </div>
        </div>

        <!-- Processing Statistics -->
        <div class="row mt-4">
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header bg-info text-white">
                        <h5 class="mb-0">⏱️ Processing Speed</h5>
                    </div>
                    <div class="card-body">
                        <p><strong>Last Hour:</strong> ${employerStats.rows[0].processed_last_hour} employers</p>
                        <p><strong>Last 24 Hours:</strong> ${employerStats.rows[0].processed_last_24_hours} employers</p>
                        <p><strong>Rate:</strong> ~${Math.round(employerStats.rows[0].processed_last_hour)} employers/hour</p>
                        <p><strong>Time to Complete:</strong> ~${Math.round(employerStats.rows[0].employers_never_scraped / (employerStats.rows[0].processed_last_hour || 1))} hours</p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header bg-success text-white">
                        <h5 class="mb-0">📊 Success Metrics</h5>
                    </div>
                    <div class="card-body">
                        <p><strong>Attempted:</strong> ${employerStats.rows[0].attempted_employers} employers</p>
                        <p><strong>Success Rate:</strong> ${Math.round((employerStats.rows[0].employers_with_emails / employerStats.rows[0].attempted_employers) * 100)}%</p>
                        <p><strong>Total Jobs:</strong> ${jobStats.rows[0].total_jobs.toLocaleString('de-DE')}</p>
                        <p><strong>Coverage:</strong> ${Math.round((employerStats.rows[0].employers_with_emails / employerStats.rows[0].total_employers) * 100)}%</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Recent Extractions -->
        <div class="card mt-4">
            <div class="card-header">
                <h5 class="mb-0">🔄 Recent Email Extractions</h5>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Employer</th>
                                <th>Email(s)</th>
                                <th>Jobs</th>
                                <th>Extracted</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentEmployers.rows.map(emp => `
                                <tr>
                                    <td>${emp.name}</td>
                                    <td><code>${emp.contact_emails || '-'}</code></td>
                                    <td>${emp.job_count}</td>
                                    <td>${new Date(emp.email_extraction_date).toLocaleString('de-DE')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Real-time Activity Monitor -->
        <div class="card mt-4" id="activity-monitor">
            <div class="card-header bg-primary text-white">
                <h5 class="mb-0">⚡ Real-time Scraping Activity</h5>
            </div>
            <div class="card-body">
                <div class="row mb-3">
                    <div class="col-md-4">
                        <div class="text-center">
                            <h6>Processing Speed</h6>
                            <div class="d-flex justify-content-around">
                                <div>
                                    <span class="badge bg-info" id="speed-1m">0</span>
                                    <small class="d-block">Last 1m</small>
                                </div>
                                <div>
                                    <span class="badge bg-info" id="speed-5m">0</span>
                                    <small class="d-block">Last 5m</small>
                                </div>
                                <div>
                                    <span class="badge bg-info" id="speed-rate">0/min</span>
                                    <small class="d-block">Rate</small>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-8">
                        <div class="text-center">
                            <h6>Success Rates (Last Hour)</h6>
                            <div class="d-flex justify-content-around">
                                <div>
                                    <span class="badge bg-success" id="rate-success">0</span>
                                    <small class="d-block">Success</small>
                                </div>
                                <div>
                                    <span class="badge bg-warning" id="rate-no-email">0</span>
                                    <small class="d-block">No Email</small>
                                </div>
                                <div>
                                    <span class="badge bg-danger" id="rate-error">0</span>
                                    <small class="d-block">Errors</small>
                                </div>
                                <div>
                                    <span class="badge bg-primary" id="rate-percentage">0%</span>
                                    <small class="d-block">Success %</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <h6>Currently Processing</h6>
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Employer</th>
                                <th>Status</th>
                                <th>Time</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody id="activity-tbody">
                            <tr><td colspan="4" class="text-center text-muted">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Auto-refresh notice -->
        <div class="text-center text-muted mt-4 mb-4">
            <small>Page refreshes every 30 seconds | Activity updates every 5 seconds</small>
        </div>
    </div>

    <script>
        // Function to update activity monitor
        async function updateActivityMonitor() {
            try {
                const response = await fetch('/api/scraping-activity');
                const data = await response.json();
                
                if (data.success) {
                    // Update speed metrics
                    document.getElementById('speed-1m').textContent = data.data.processingSpeed.lastMinute;
                    document.getElementById('speed-5m').textContent = data.data.processingSpeed.last5Minutes;
                    document.getElementById('speed-rate').textContent = data.data.processingSpeed.perMinute + '/min';
                    
                    // Update success rates
                    document.getElementById('rate-success').textContent = data.data.successRates.successful;
                    document.getElementById('rate-no-email').textContent = data.data.successRates.noEmails;
                    document.getElementById('rate-error').textContent = data.data.successRates.errors;
                    document.getElementById('rate-percentage').textContent = data.data.successRates.successRate + '%';
                    
                    // Update activity table
                    const tbody = document.getElementById('activity-tbody');
                    if (data.data.currentlyProcessing.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No active processing</td></tr>';
                    } else {
                        tbody.innerHTML = data.data.currentlyProcessing.map(item => {
                            let statusBadge = '';
                            switch(item.status) {
                                case 'success':
                                    statusBadge = '<span class="badge bg-success">✓ Success</span>';
                                    break;
                                case 'error':
                                    statusBadge = '<span class="badge bg-danger">✗ Error</span>';
                                    break;
                                case 'no_email':
                                    statusBadge = '<span class="badge bg-warning">No Email</span>';
                                    break;
                                default:
                                    statusBadge = '<span class="badge bg-info">Processing</span>';
                            }
                            
                            const emails = item.contact_emails || item.best_email || '-';
                            const emailDisplay = emails.length > 40 ? emails.substring(0, 40) + '...' : emails;
                            
                            return `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${statusBadge}</td>
                                    <td><small>${item.time_ago}</small></td>
                                    <td><small><code>${emailDisplay}</code></small></td>
                                </tr>
                            `;
                        }).join('');
                    }
                }
            } catch (error) {
                console.error('Failed to update activity monitor:', error);
            }
        }
        
        // Update activity monitor every 5 seconds
        updateActivityMonitor();
        setInterval(updateActivityMonitor, 5000);
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>
            `;

            res.send(html);

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Dashboard error: ' + error.message);
    }
});

// API endpoint for scraping activity
app.get('/api/scraping-activity', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get currently processing employers (last 5 minutes)
            const currentlyProcessingQuery = `
                SELECT 
                    name,
                    website,
                    email_extraction_date,
                    contact_emails,
                    best_email,
                    has_emails,
                    notes,
                    CASE 
                        WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 'success'
                        WHEN notes LIKE '%error%' OR notes LIKE '%Error%' THEN 'error'
                        WHEN notes LIKE '%no email%' OR notes LIKE '%No email%' THEN 'no_email'
                        ELSE 'processing'
                    END as status,
                    EXTRACT(EPOCH FROM (NOW() - email_extraction_date)) as seconds_ago
                FROM job_scrp_employers
                WHERE email_extraction_date > NOW() - INTERVAL '5 minutes'
                ORDER BY email_extraction_date DESC
                LIMIT 50
            `;
            const currentlyProcessing = await client.query(currentlyProcessingQuery);

            // Get success/failure rates for last hour
            const successRatesQuery = `
                SELECT 
                    COUNT(*) as total_attempted,
                    COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as successful,
                    COUNT(CASE WHEN notes LIKE '%error%' OR notes LIKE '%Error%' THEN 1 END) as errors,
                    COUNT(CASE WHEN (notes LIKE '%no email%' OR notes LIKE '%No email%') AND (contact_emails IS NULL OR contact_emails = '') THEN 1 END) as no_emails
                FROM job_scrp_employers
                WHERE email_extraction_date > NOW() - INTERVAL '1 hour'
                    AND email_extraction_attempted = true
            `;
            const successRates = await client.query(successRatesQuery);

            // Get processing speed metrics
            const speedMetricsQuery = `
                SELECT 
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '1 minute' THEN 1 END) as last_minute,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '5 minutes' THEN 1 END) as last_5_minutes,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '15 minutes' THEN 1 END) as last_15_minutes
                FROM job_scrp_employers
                WHERE email_extraction_attempted = true
            `;
            const speedMetrics = await client.query(speedMetricsQuery);

            const rates = successRates.rows[0];
            const successRate = rates.total_attempted > 0 ? 
                Math.round((rates.successful / rates.total_attempted) * 100) : 0;

            res.json({
                success: true,
                data: {
                    currentlyProcessing: currentlyProcessing.rows.map(row => ({
                        ...row,
                        time_ago: formatTimeAgo(row.seconds_ago)
                    })),
                    successRates: {
                        total: parseInt(rates.total_attempted),
                        successful: parseInt(rates.successful),
                        errors: parseInt(rates.errors),
                        noEmails: parseInt(rates.no_emails),
                        successRate: successRate
                    },
                    processingSpeed: {
                        lastMinute: parseInt(speedMetrics.rows[0].last_minute),
                        last5Minutes: parseInt(speedMetrics.rows[0].last_5_minutes),
                        last15Minutes: parseInt(speedMetrics.rows[0].last_15_minutes),
                        perMinute: parseFloat((speedMetrics.rows[0].last_5_minutes / 5).toFixed(1))
                    }
                },
                timestamp: new Date().toISOString()
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Scraping activity error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper function to format time ago
function formatTimeAgo(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
}

// API endpoint for real-time stats
app.get('/api/stats', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            const stats = await client.query(`
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted,
                    COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as with_emails,
                    COUNT(CASE WHEN email_extraction_attempted = false THEN 1 END) as never_scraped,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
                FROM job_scrp_employers
            `);
            
            res.json({
                success: true,
                data: stats.rows[0],
                timestamp: new Date().toISOString()
            });
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Employer Dashboard running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔧 API Stats: http://localhost:${PORT}/api/stats`);
    console.log(`⚡ API Activity: http://localhost:${PORT}/api/scraping-activity`);
});