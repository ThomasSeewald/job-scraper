// New domains integration route for combined-dashboard.js
// This replaces the old employer-domains route with our new integration system

const domainsIntegrationRoute = async (req, res, pool) => {
    try {
        const client = await pool.connect();
        try {
            // Get integration statistics
            const integrationStatsQuery = `
                SELECT * FROM employer_domain_integration_stats
            `;
            const integrationStats = await client.query(integrationStatsQuery);
            const stats = {};
            integrationStats.rows.forEach(row => {
                stats[row.metric.toLowerCase().replace(/\s+/g, '_')] = parseInt(row.value);
            });

            // Get retry queue summary
            const retryQueueQuery = `
                SELECT 
                    retry_category,
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN retry_success = true THEN 1 END) as successful,
                    AVG(priority) as avg_priority
                FROM our_domains_retry_queue 
                GROUP BY retry_category 
                ORDER BY avg_priority ASC
            `;
            const retryQueue = await client.query(retryQueueQuery);

            // Get sample domain matches
            const domainMatchesQuery = `
                SELECT 
                    employer_name,
                    domain_url,
                    match_type,
                    match_confidence,
                    status,
                    emails_found,
                    extracted_emails,
                    created_at
                FROM our_employer_domain_matches
                WHERE status = 'verified' AND emails_found = true
                ORDER BY created_at DESC
                LIMIT 20
            `;
            const domainMatches = await client.query(domainMatchesQuery);

            // Get error analysis from our_domains
            const errorAnalysisQuery = `
                SELECT 
                    CASE 
                        WHEN error_message LIKE '%DNS Lookup Error%' THEN 'DNS Lookup Error'
                        WHEN error_message LIKE '%Forbidden for scrapy%' THEN 'Forbidden (Scrapy Blocked)'
                        WHEN error_message LIKE '%Timeout Error%' THEN 'Timeout Error'
                        WHEN error_message LIKE '%kontakt_link%' THEN 'Contact Link Missing'
                        WHEN error_message LIKE '%Expecting value%' THEN 'JSON Parsing Error'
                        WHEN error_message LIKE '%Domain expired%' THEN 'Domain Expired'
                        ELSE 'Other Errors'
                    END as error_category,
                    COUNT(*) as count,
                    COUNT(CASE WHEN source = 'yellow_pages' THEN 1 END) as yellow_pages,
                    COUNT(CASE WHEN source = 'employment_agency' THEN 1 END) as employment_agency
                FROM our_domains 
                WHERE error_message IS NOT NULL 
                    AND error_message != ''
                    AND emails_found != true
                GROUP BY 
                    CASE 
                        WHEN error_message LIKE '%DNS Lookup Error%' THEN 'DNS Lookup Error'
                        WHEN error_message LIKE '%Forbidden for scrapy%' THEN 'Forbidden (Scrapy Blocked)'
                        WHEN error_message LIKE '%Timeout Error%' THEN 'Timeout Error'
                        WHEN error_message LIKE '%kontakt_link%' THEN 'Contact Link Missing'
                        WHEN error_message LIKE '%Expecting value%' THEN 'JSON Parsing Error'
                        WHEN error_message LIKE '%Domain expired%' THEN 'Domain Expired'
                        ELSE 'Other Errors'
                    END
                ORDER BY count DESC
            `;
            const errorAnalysis = await client.query(errorAnalysisQuery);

            // Get recent retry successes
            const recentRetriesQuery = `
                SELECT 
                    rq.domain_url,
                    rq.retry_category,
                    rq.new_emails,
                    rq.completed_at,
                    d.the_name as domain_name,
                    d.source as original_source
                FROM our_domains_retry_queue rq
                JOIN our_domains d ON d.id = rq.domain_id
                WHERE rq.retry_success = true
                    AND rq.completed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                ORDER BY rq.completed_at DESC
                LIMIT 15
            `;
            const recentRetries = await client.query(recentRetriesQuery);

            // Render the new integration dashboard
            res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domains Integration Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .integration-card { 
            background: white; 
            border-radius: 8px; 
            padding: 20px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
            margin-bottom: 20px; 
            border-left: 4px solid #007bff;
        }
        .stat-value { 
            font-size: 2.2em; 
            font-weight: bold; 
            margin: 8px 0; 
        }
        .stat-label { 
            color: #666; 
            font-size: 0.9em; 
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .retry-category {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
            display: inline-block;
            margin: 2px;
        }
        .retry-dns { background: #e3f2fd; color: #1565c0; }
        .retry-playwright { background: #f3e5f5; color: #7b1fa2; }
        .retry-link { background: #fff3e0; color: #ef6c00; }
        .retry-timeout { background: #e8f5e8; color: #2e7d32; }
        .match-confidence {
            width: 60px;
            height: 6px;
            background: #e0e0e0;
            border-radius: 3px;
            overflow: hidden;
        }
        .confidence-fill {
            height: 100%;
            background: linear-gradient(90deg, #ff5722 0%, #ff9800 50%, #4caf50 100%);
        }
        .btn-action {
            margin: 2px;
            font-size: 0.85em;
        }
        .table-responsive {
            max-height: 400px;
            overflow-y: auto;
        }
    </style>
</head>
<body class="bg-light">
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container-fluid">
            <a class="navbar-brand" href="/"><i class="fas fa-chart-line"></i> Job Scraper Dashboard</a>
            <div class="navbar-nav">
                <a class="nav-link" href="/"><i class="fas fa-home"></i> Main</a>
                <a class="nav-link active" href="/domains-integration"><i class="fas fa-link"></i> Domains Integration</a>
                <a class="nav-link" href="/email-search"><i class="fas fa-envelope"></i> Email Search</a>
            </div>
        </div>
    </nav>

    <div class="container-fluid mt-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h1><i class="fas fa-link text-primary"></i> Domains Integration System</h1>
            <div>
                <button class="btn btn-success me-2" onclick="startRetryProcessor()">
                    <i class="fas fa-play"></i> Start Retry Processing
                </button>
                <button class="btn btn-outline-primary" onclick="location.reload()">
                    <i class="fas fa-sync"></i> Refresh
                </button>
            </div>
        </div>

        <!-- Integration Overview -->
        <div class="row mb-4">
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">Total Active Jobs</div>
                    <div class="stat-value text-primary">${stats.total_active_jobs?.toLocaleString() || '0'}</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">Jobs with Details</div>
                    <div class="stat-value text-info">${stats.jobs_with_scraped_details?.toLocaleString() || '0'}</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">Domain Matches</div>
                    <div class="stat-value text-success">${stats.domain_matches_found?.toLocaleString() || '0'}</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">Verified + Emails</div>
                    <div class="stat-value text-warning">${stats.verified_matches_with_emails?.toLocaleString() || '0'}</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">Retry Queue</div>
                    <div class="stat-value text-danger">${stats.retry_queue_size?.toLocaleString() || '0'}</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="integration-card text-center">
                    <div class="stat-label">High Priority</div>
                    <div class="stat-value text-dark">${stats.high_priority_retries?.toLocaleString() || '0'}</div>
                </div>
            </div>
        </div>

        <div class="row">
            <!-- Retry Queue Status -->
            <div class="col-md-6">
                <div class="integration-card">
                    <h4><i class="fas fa-redo text-warning"></i> Retry Queue by Category</h4>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Category</th>
                                    <th>Total</th>
                                    <th>Queued</th>
                                    <th>Completed</th>
                                    <th>Success Rate</th>
                                    <th>Priority</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${retryQueue.rows.map(row => {
                                    const successRate = row.successful && row.completed ? 
                                        Math.round((row.successful / row.completed) * 100) : 0;
                                    const categoryClass = {
                                        'dns_retry': 'retry-dns',
                                        'playwright_retry': 'retry-playwright', 
                                        'link_detection_retry': 'retry-link',
                                        'timeout_retry': 'retry-timeout'
                                    }[row.retry_category] || 'retry-other';
                                    
                                    return `
                                        <tr>
                                            <td><span class="retry-category ${categoryClass}">${row.retry_category}</span></td>
                                            <td><strong>${row.total}</strong></td>
                                            <td><span class="badge bg-primary">${row.queued}</span></td>
                                            <td><span class="badge bg-success">${row.completed}</span></td>
                                            <td>${successRate}%</td>
                                            <td>${parseFloat(row.avg_priority).toFixed(1)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="mt-3">
                        <button class="btn btn-sm btn-outline-primary btn-action" onclick="processRetryCategory('dns_retry')">
                            Process DNS Retries
                        </button>
                        <button class="btn btn-sm btn-outline-primary btn-action" onclick="processRetryCategory('playwright_retry')">
                            Process Playwright Retries
                        </button>
                        <button class="btn btn-sm btn-outline-primary btn-action" onclick="processRetryCategory('link_detection_retry')">
                            Process Link Detection
                        </button>
                    </div>
                </div>
            </div>

            <!-- Error Analysis -->
            <div class="col-md-6">
                <div class="integration-card">
                    <h4><i class="fas fa-exclamation-triangle text-danger"></i> Error Analysis (our_domains)</h4>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Error Type</th>
                                    <th>Count</th>
                                    <th>Yellow Pages</th>
                                    <th>Employment</th>
                                    <th>Retry Potential</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${errorAnalysis.rows.map(row => {
                                    const retryPotential = {
                                        'DNS Lookup Error': 'High',
                                        'Forbidden (Scrapy Blocked)': 'Very High',
                                        'Contact Link Missing': 'Medium',
                                        'Timeout Error': 'Medium',
                                        'JSON Parsing Error': 'Low',
                                        'Domain Expired': 'None'
                                    }[row.error_category] || 'Unknown';
                                    
                                    const potentialClass = {
                                        'Very High': 'text-success fw-bold',
                                        'High': 'text-primary fw-bold',
                                        'Medium': 'text-warning',
                                        'Low': 'text-muted',
                                        'None': 'text-danger'
                                    }[retryPotential] || '';
                                    
                                    return `
                                        <tr>
                                            <td><small>${row.error_category}</small></td>
                                            <td><strong>${row.count}</strong></td>
                                            <td>${row.yellow_pages}</td>
                                            <td>${row.employment_agency}</td>
                                            <td><span class="${potentialClass}">${retryPotential}</span></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <!-- Recent Domain Matches -->
            <div class="col-md-6">
                <div class="integration-card">
                    <h4><i class="fas fa-check-circle text-success"></i> Recent Successful Matches</h4>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Employer</th>
                                    <th>Domain</th>
                                    <th>Type</th>
                                    <th>Confidence</th>
                                    <th>Emails</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${domainMatches.rows.map(row => {
                                    const confidenceWidth = Math.round((row.match_confidence || 0) * 100);
                                    const emailCount = row.extracted_emails ? row.extracted_emails.split(',').length : 0;
                                    
                                    return `
                                        <tr>
                                            <td><small>${(row.employer_name || '').substring(0, 25)}</small></td>
                                            <td><small>${row.domain_url}</small></td>
                                            <td><span class="badge bg-secondary">${row.match_type}</span></td>
                                            <td>
                                                <div class="match-confidence">
                                                    <div class="confidence-fill" style="width: ${confidenceWidth}%"></div>
                                                </div>
                                            </td>
                                            <td><span class="badge bg-success">${emailCount}</span></td>
                                            <td><small>${new Date(row.created_at).toLocaleDateString('de-DE')}</small></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Recent Retry Successes -->
            <div class="col-md-6">
                <div class="integration-card">
                    <h4><i class="fas fa-trophy text-warning"></i> Recent Retry Successes</h4>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Domain</th>
                                    <th>Category</th>
                                    <th>Source</th>
                                    <th>Emails Found</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recentRetries.rows.map(row => {
                                    const emailCount = row.new_emails ? row.new_emails.split(',').length : 0;
                                    const categoryClass = {
                                        'dns_retry': 'retry-dns',
                                        'playwright_retry': 'retry-playwright', 
                                        'link_detection_retry': 'retry-link',
                                        'timeout_retry': 'retry-timeout'
                                    }[row.retry_category] || 'retry-other';
                                    
                                    return `
                                        <tr>
                                            <td><small>${row.domain_url}</small></td>
                                            <td><span class="retry-category ${categoryClass}">${row.retry_category}</span></td>
                                            <td><small>${row.original_source}</small></td>
                                            <td><span class="badge bg-success">${emailCount}</span></td>
                                            <td><small>${new Date(row.completed_at).toLocaleDateString('de-DE')}</small></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div class="row">
            <div class="col-12">
                <div class="integration-card">
                    <h4><i class="fas fa-tools text-primary"></i> Management Actions</h4>
                    <div class="btn-group me-3" role="group">
                        <button class="btn btn-outline-primary btn-action" onclick="runFuzzyMatching()">
                            <i class="fas fa-search"></i> Run Fuzzy Matching
                        </button>
                        <button class="btn btn-outline-success btn-action" onclick="verifyDomainMatches()">
                            <i class="fas fa-check"></i> Verify Matches
                        </button>
                        <button class="btn btn-outline-warning btn-action" onclick="exportIntegrationData()">
                            <i class="fas fa-download"></i> Export Data
                        </button>
                    </div>
                    
                    <div class="btn-group" role="group">
                        <button class="btn btn-outline-info btn-action" onclick="viewRetryLogs()">
                            <i class="fas fa-file-alt"></i> View Logs
                        </button>
                        <button class="btn btn-outline-secondary btn-action" onclick="systemStatus()">
                            <i class="fas fa-heartbeat"></i> System Status
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        function startRetryProcessor() {
            if (confirm('Start the domains retry processor? This will begin processing failed domains in the background.')) {
                fetch('/api/start-retry-processor', { method: 'POST' })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            alert('Retry processor started successfully!');
                        } else {
                            alert('Error starting processor: ' + (data.error || 'Unknown error'));
                        }
                    })
                    .catch(error => alert('Error: ' + error.message));
            }
        }

        function processRetryCategory(category) {
            if (confirm(\`Process all \${category} domains? This may take several minutes.\`)) {
                fetch('/api/process-retry-category', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category: category })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert(\`Processing started for \${category}. Check logs for progress.\`);
                    } else {
                        alert('Error: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(error => alert('Error: ' + error.message));
            }
        }

        function runFuzzyMatching() {
            alert('Fuzzy matching feature coming soon!');
        }

        function verifyDomainMatches() {
            alert('Domain verification feature coming soon!');
        }

        function exportIntegrationData() {
            window.open('/api/export-integration-data', '_blank');
        }

        function viewRetryLogs() {
            window.open('/api/retry-logs', '_blank');
        }

        function systemStatus() {
            fetch('/api/system-status')
                .then(response => response.json())
                .then(data => {
                    const status = data.success ? 'System is running normally' : 'System has issues';
                    alert(status + '\\n\\nDetails:\\n' + JSON.stringify(data, null, 2));
                })
                .catch(error => alert('Error checking status: ' + error.message));
        }

        // Auto-refresh every 2 minutes
        setInterval(() => {
            location.reload();
        }, 120000);
    </script>
</body>
</html>
            `);

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error in domains integration route:', error);
        res.status(500).send(`
            <h1>Error</h1>
            <p>Database connection error: ${error.message}</p>
            <a href="/">Back to Dashboard</a>
        `);
    }
};

module.exports = domainsIntegrationRoute;