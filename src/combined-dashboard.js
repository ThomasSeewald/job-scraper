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

// Main dashboard route
app.get('/', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get basic statistics with meaningful unique counts
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN jd.best_email IS NOT NULL THEN 1 END) as jobs_with_emails,
                    COUNT(DISTINCT jd.company_domain) as unique_domains,
                    COUNT(DISTINCT j.arbeitsort_plz) as unique_locations,
                    MAX(j.scraped_at) as last_scan
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
            const stats = await client.query(statsQuery);

            // Get unique email and employer statistics
            const uniqueStatsQuery = `
                SELECT 
                    COUNT(DISTINCT TRIM(LOWER(email_addr))) as unique_emails,
                    COUNT(DISTINCT TRIM(LOWER(jd.company_domain))) as unique_domains_with_emails,
                    COUNT(DISTINCT TRIM(LOWER(j.arbeitgeber))) as unique_employers_with_emails
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                CROSS JOIN LATERAL unnest(string_to_array(jd.contact_emails, ',')) AS email_addr
                WHERE j.is_active = true 
                    AND jd.contact_emails IS NOT NULL 
                    AND jd.contact_emails != ''
                    AND TRIM(email_addr) != ''
            `;
            const uniqueStats = await client.query(uniqueStatsQuery);

            // Get employer statistics (regardless of emails)
            const employerStatsQuery = `
                SELECT 
                    COUNT(DISTINCT TRIM(LOWER(j.arbeitgeber))) as total_unique_employers
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                WHERE j.is_active = true 
                    AND j.arbeitgeber IS NOT NULL 
                    AND j.arbeitgeber != ''
            `;
            const employerStats = await client.query(employerStatsQuery);

            // Get detail scraping statistics
            const scrapingStatsQuery = `
                SELECT 
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '1 hour' THEN 1 END) as scraped_last_hour,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '5 hours' THEN 1 END) as scraped_last_5_hours,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '24 hours' THEN 1 END) as scraped_last_24_hours,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '1 hour' AND has_emails = true THEN 1 END) as emails_found_last_hour,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '5 hours' AND has_emails = true THEN 1 END) as emails_found_last_5_hours,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '24 hours' AND has_emails = true THEN 1 END) as emails_found_last_24_hours,
                    COUNT(CASE WHEN scraped_at > NOW() - INTERVAL '24 hours' AND scraping_success = false THEN 1 END) as failed_last_24_hours,
                    ROUND(AVG(CASE WHEN scraped_at > NOW() - INTERVAL '24 hours' THEN scraping_duration_ms END)) as avg_duration_ms
                FROM job_scrp_job_details
                WHERE scraped_at IS NOT NULL
            `;
            const scrapingStats = await client.query(scrapingStatsQuery);

            // Get domain extraction statistics
            const domainStatsQuery = `
                SELECT 
                    COUNT(*) as total_domains,
                    COUNT(CASE WHEN classification = 'employer_domain' THEN 1 END) as employer_domains,
                    COUNT(CASE WHEN classification = 'external_portal' THEN 1 END) as external_portals,
                    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as extraction_attempted,
                    COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails,
                    COUNT(CASE WHEN emails_found = 0 THEN 1 END) as domains_without_emails,
                    COUNT(CASE WHEN classification = 'employer_domain' AND emails_found > 0 THEN 1 END) as employer_domains_with_emails,
                    COUNT(CASE WHEN classification = 'employer_domain' AND emails_found = 0 THEN 1 END) as employer_domains_without_emails,
                    (SELECT COUNT(DISTINCT TRIM(LOWER(email_addr))) 
                     FROM job_scrp_job_details jd
                     CROSS JOIN LATERAL unnest(string_to_array(jd.contact_emails, ',')) AS email_addr
                     WHERE jd.contact_emails IS NOT NULL AND jd.contact_emails != ''
                    ) as total_unique_emails
                FROM job_scrp_domain_analysis
            `;
            const domainStats = await client.query(domainStatsQuery);

            // Get parallel services statistics (with real-time data)
            const parallelServicesQuery = `
                SELECT 
                    -- Keyword Domain Scraper (now uses employers table)
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE website IS NOT NULL AND website != '') as total_domains,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE website IS NOT NULL AND website != '' AND notes LIKE '%Keyword scraping%') as attempted,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE website IS NOT NULL AND website != '' AND contact_emails IS NOT NULL AND contact_emails != '' AND notes LIKE '%Keyword scraping%') as with_emails,
                    (SELECT COUNT(*) FROM (SELECT DISTINCT UNNEST(string_to_array(contact_emails, ', ')) FROM job_scrp_employers WHERE notes LIKE '%Keyword scraping%' AND contact_emails IS NOT NULL) AS emails) as total_emails_found,
                    -- Employer Scraper stats
                    (SELECT COUNT(*) FROM job_scrp_employers) as total_employers,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_attempted = true) as employer_attempted,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE contact_emails IS NOT NULL AND contact_emails != '') as employer_with_emails,
                    (SELECT COUNT(*) FROM job_scrp_job_details WHERE scraped_for_keywords = true) as keyword_extracted_count,
                    -- Keyword scraper time-based stats
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE last_updated > NOW() - INTERVAL '1 hour' AND notes LIKE '%Keyword scraping%') as processed_last_hour,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE last_updated > NOW() - INTERVAL '24 hours' AND notes LIKE '%Keyword scraping%') as processed_last_24h,
                    -- Employer scraper time-based stats  
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_date > NOW() - INTERVAL '1 hour') as employer_processed_last_hour,
                    (SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_date > NOW() - INTERVAL '24 hours') as employer_processed_last_24h,
                    (SELECT COUNT(*) FROM job_scrp_job_details WHERE scraped_for_keywords = true AND updated_at > NOW() - INTERVAL '1 hour') as keyword_extracted_last_hour,
                    -- Last run times
                    (SELECT MAX(last_updated) FROM job_scrp_employers WHERE notes LIKE '%Keyword scraping%') as last_run,
                    (SELECT MAX(email_extraction_date) FROM job_scrp_employers) as employer_last_run
            `;
            const parallelServices = await client.query(parallelServicesQuery);

            // Get employer table statistics (for the employer section)
            const employerTableStatsQuery = `
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted_employers,
                    COUNT(CASE WHEN contact_emails IS NOT NULL AND contact_emails != '' THEN 1 END) as employers_with_emails,
                    COUNT(CASE WHEN email_extraction_date > NOW() - INTERVAL '24 hours' THEN 1 END) as processed_last_24_hours
                FROM job_scrp_employers
            `;
            const employerTableStats = await client.query(employerTableStatsQuery);

            // Get cron job status (check recent activities)
            const cronStatusQuery = `
                WITH recent_api_jobs AS (
                    SELECT MAX(scraped_at) as last_run 
                    FROM job_scrp_arbeitsagentur_jobs_v2 
                    WHERE scraped_at > NOW() - INTERVAL '12 hours'
                ),
                recent_detail_scraping AS (
                    SELECT MAX(scraped_at) as last_run 
                    FROM job_scrp_job_details 
                    WHERE scraped_at > NOW() - INTERVAL '12 hours'
                ),
                recent_domain_extraction AS (
                    SELECT MAX(last_extraction_date) as last_run 
                    FROM job_scrp_domain_analysis 
                    WHERE last_extraction_date > NOW() - INTERVAL '24 hours'
                )
                SELECT 
                    (SELECT last_run FROM recent_api_jobs) as last_api_run,
                    (SELECT last_run FROM recent_detail_scraping) as last_detail_run,
                    (SELECT last_run FROM recent_domain_extraction) as last_domain_run
            `;
            const cronStatus = await client.query(cronStatusQuery);

            // Get recent scans
            const recentQuery = `
                SELECT 
                    DATE(scraped_at) as scan_date,
                    COUNT(*) as jobs_scanned
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE scraped_at > NOW() - INTERVAL '7 days'
                GROUP BY DATE(scraped_at)
                ORDER BY scan_date DESC
                LIMIT 7
            `;
            const recentScans = await client.query(recentQuery);

            // Get PLZ statistics - REMOVED for performance optimization
            // This query is no longer needed as PLZ section was removed from dashboard
            const plzStats = { rows: [] }; // Empty result to avoid breaking code

            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Job Scraper Dashboard</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .stats-card { border: none; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                        .nav-section { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                    </style>
                </head>
                <body>
                    <nav class="navbar navbar-dark bg-dark">
                        <div class="container-fluid">
                            <span class="navbar-brand">🤖 Job Scraper Dashboard</span>
                            <div>
                                <a href="/email-search" class="btn btn-outline-light btn-sm me-2">📧 Email-Suche</a>
                                <a href="/domains-integration" class="btn btn-outline-light btn-sm">🔗 Domains Integration</a>
                            </div>
                        </div>
                    </nav>

                    <div class="nav-section text-center py-4">
                        <h1>Job Scraper Dashboard</h1>
                        <p>Übersicht über Scraping-Aktivitäten und Email-Extraktion</p>
                    </div>

                    <div class="container mt-4">

                        <!-- Parallel Email Extraction Services -->
                        <div class="card mb-4">
                            <div class="card-header bg-success text-white">
                                <h5 class="mb-0">🔄 Parallel Email-Extraktion Services</h5>
                                <small>Unabhängige Domain- und Arbeitgeber-basierte Email-Extraktion</small>
                            </div>
                            <div class="card-body">
                                <div class="row g-4">
                                    <!-- Keyword Domain Scraper -->
                                    <div class="col-md-4">
                                        <div class="card border-info">
                                            <div class="card-header bg-info text-white text-center">
                                                <h6 class="mb-0">🔍 Keyword Domain Scraper</h6>
                                                <small>Every 30 minutes</small>
                                            </div>
                                            <div class="card-body">
                                                <div class="row text-center">
                                                    <div class="col-12 mb-2">
                                                        <h4 class="text-info">${Number(parallelServices.rows[0].total_domains).toLocaleString()}</h4>
                                                        <small class="text-muted">Employers with Websites but no Emails</small>
                                                    </div>
                                                    <div class="col-6">
                                                        <h5 class="text-success">${Number(parallelServices.rows[0].attempted).toLocaleString()}</h5>
                                                        <small class="text-muted">Detail Pages Scanned</small>
                                                    </div>
                                                    <div class="col-6">
                                                        <h5 class="text-warning">${Number(parallelServices.rows[0].with_emails).toLocaleString()}</h5>
                                                        <small class="text-muted">With Emails</small>
                                                    </div>
                                                    <div class="col-6 mt-2">
                                                        <span class="badge bg-primary">${Number(parallelServices.rows[0].processed_last_hour)}</span>
                                                        <small class="d-block text-muted">Last Hour</small>
                                                    </div>
                                                    <div class="col-6 mt-2">
                                                        <span class="badge bg-secondary">${Number(parallelServices.rows[0].processed_last_24h)}</span>
                                                        <small class="d-block text-muted">Last 24h</small>
                                                    </div>
                                                    <div class="col-12 mt-2">
                                                        <small class="text-success">📧 ${Number(parallelServices.rows[0].total_emails_found)} emails found</small>
                                                    </div>
                                                    <div class="col-12 mt-1">
                                                        <small class="text-muted">Last run: ${parallelServices.rows[0].last_run ? new Date(parallelServices.rows[0].last_run).toLocaleString('de-DE') : 'Never'}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Employer Scraper -->
                                    <div class="col-md-4">
                                        <div class="card border-warning">
                                            <div class="card-header bg-warning text-dark text-center">
                                                <h6 class="mb-0">🏢 Employer Scraper</h6>
                                                <small>Every 2-6 hours</small>
                                            </div>
                                            <div class="card-body">
                                                <div class="row text-center">
                                                    <div class="col-12 mb-2">
                                                        <h4 class="text-warning">${Number(parallelServices.rows[0].total_employers).toLocaleString()}</h4>
                                                        <small class="text-muted">Total Unique Employers</small>
                                                    </div>
                                                    <div class="col-6">
                                                        <h5 class="text-success">${Number(parallelServices.rows[0].employer_attempted).toLocaleString()}</h5>
                                                        <small class="text-muted">Detail Pages Scanned</small>
                                                    </div>
                                                    <div class="col-6">
                                                        <h5 class="text-info">${Number(parallelServices.rows[0].employer_with_emails).toLocaleString()}</h5>
                                                        <small class="text-muted">With Emails</small>
                                                    </div>
                                                    <div class="col-6 mt-2">
                                                        <span class="badge bg-primary">${Number(parallelServices.rows[0].employer_processed_last_hour)}</span>
                                                        <small class="d-block text-muted">Last Hour</small>
                                                    </div>
                                                    <div class="col-6 mt-2">
                                                        <span class="badge bg-secondary">${Number(parallelServices.rows[0].employer_processed_last_24h)}</span>
                                                        <small class="d-block text-muted">Last 24h</small>
                                                    </div>
                                                    <div class="col-12 mt-2">
                                                        <small class="text-success">📈 ${parallelServices.rows[0].employer_with_emails > 0 ? Math.round((Number(parallelServices.rows[0].employer_with_emails) / Number(parallelServices.rows[0].employer_attempted)) * 100) : 0}% success rate</small>
                                                    </div>
                                                    <div class="col-12 mt-1">
                                                        <small class="text-muted">Last run: ${parallelServices.rows[0].employer_last_run ? new Date(parallelServices.rows[0].employer_last_run).toLocaleString('de-DE') : 'Never'}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                </div>

                                <!-- Service Status Row -->
                                <div class="row mt-3">
                                    <div class="col-12">
                                        <div class="alert alert-info">
                                            <h6>🔧 Parallel Services Architecture:</h6>
                                            <ul class="mb-0 small">
                                                <li><strong>Keyword Domain Scraper:</strong> Searches impressum, kontakt, karriere, jobs pages on company domains</li>
                                                <li><strong>Employer Scraper:</strong> Processes job detail pages to extract emails from Arbeitsagentur</li>
                                                <li><strong>Architecture:</strong> Both services run independently to maximize email extraction coverage</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>


                        <!-- System Overview -->
                        <div class="row g-4 mb-4">
                            <div class="col-md-6">
                                <div class="card">
                                    <div class="card-header">
                                        <h6>🏢 Arbeitgeber-Statistiken</h6>
                                    </div>
                                    <div class="card-body">
                                        <div class="row">
                                            <div class="col-6">
                                                <div class="d-flex justify-content-between">
                                                    <span>Einträge (DB):</span>
                                                    <strong>${Number(employerTableStats.rows[0].total_employers).toLocaleString()} <small class="text-muted">job_scrp_employers</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span>Unique (API):</span>
                                                    <strong class="text-info">${Number(employerStats.rows[0].total_unique_employers).toLocaleString()} <small class="text-muted">jobs_v2</small></strong>
                                                </div>
                                            </div>
                                            <div class="col-6">
                                                <div class="d-flex justify-content-between">
                                                    <span>Mit Emails:</span>
                                                    <strong class="text-success">${Number(uniqueStats.rows[0].unique_employers_with_emails || 0).toLocaleString()} <small class="text-muted">jobs_v2+details</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span>Heute bearbeitet:</span>
                                                    <strong>${Number(employerTableStats.rows[0].processed_last_24_hours).toLocaleString()} <small class="text-muted">job_scrp_employers</small></strong>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="card">
                                    <div class="card-header">
                                        <h6>🌐 Domain-Analyse</h6>
                                    </div>
                                    <div class="card-body">
                                        <div class="row">
                                            <div class="col-6">
                                                <div class="d-flex justify-content-between">
                                                    <span>Arbeitgeber-Domains:</span>
                                                    <strong>${Number(domainStats.rows[0].employer_domains).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span class="text-muted small">→ mit Emails:</span>
                                                    <strong class="text-success">${Number(domainStats.rows[0].employer_domains_with_emails).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span class="text-muted small">→ ohne Emails:</span>
                                                    <strong class="text-warning">${Number(domainStats.rows[0].employer_domains_without_emails).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span>Job-Portale:</span>
                                                    <strong>${Number(domainStats.rows[0].external_portals).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                            </div>
                                            <div class="col-6">
                                                <div class="d-flex justify-content-between">
                                                    <span>Gesamt mit Emails:</span>
                                                    <strong class="text-success">${Number(domainStats.rows[0].domains_with_emails).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span>Gesamt ohne Emails:</span>
                                                    <strong class="text-warning">${Number(domainStats.rows[0].domains_without_emails).toLocaleString()} <small class="text-muted">job_scrp_domain_analysis</small></strong>
                                                </div>
                                                <div class="d-flex justify-content-between">
                                                    <span>Unique Emails:</span>
                                                    <strong class="text-info">${Number(domainStats.rows[0].total_unique_emails || 0).toLocaleString()} <small class="text-muted">job_scrp_job_details</small></strong>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Quick Actions -->
                        <div class="row g-4 mb-4">
                            <div class="col-md-4">
                                <div class="card">
                                    <div class="card-body text-center">
                                        <h5>📧 Email-Suche</h5>
                                        <p>Suche und Export von Email-Adressen</p>
                                        <a href="/email-search" class="btn btn-primary">Zur Email-Suche</a>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="card">
                                    <div class="card-body text-center">
                                        <h5>⚙️ Scraper-Steuerung</h5>
                                        <p>Scraping-Prozesse starten und überwachen</p>
                                        <a href="/scraper-control" class="btn btn-warning">Scraper-Kontrolle</a>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cron Job Monitoring -->
                        <div class="card mb-4">
                            <div class="card-header bg-info text-white">
                                <h5 class="mb-0">⏰ Cron Job Status</h5>
                            </div>
                            <div class="card-body">
                                <div class="row g-3">
                                    <div class="col-md-3">
                                        <div class="p-3 border rounded">
                                            <h6>📡 API Collection</h6>
                                            <small class="text-muted">Alle 4 Stunden</small>
                                            <div class="mt-2">
                                                ${cronStatus.rows[0].last_api_run ? 
                                                    `<span class="badge bg-success">Aktiv</span>
                                                     <div class="small text-muted">Letzter Lauf: ${new Date(cronStatus.rows[0].last_api_run).toLocaleTimeString('de-DE')}</div>` :
                                                    `<span class="badge bg-warning">Keine Aktivität</span>`}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="p-3 border rounded">
                                            <h6>🔍 Detail Scraping</h6>
                                            <small class="text-muted">Alle 2 Stunden</small>
                                            <div class="mt-2">
                                                ${cronStatus.rows[0].last_detail_run ? 
                                                    `<span class="badge bg-success">Aktiv</span>
                                                     <div class="small text-muted">Letzter Lauf: ${new Date(cronStatus.rows[0].last_detail_run).toLocaleTimeString('de-DE')}</div>` :
                                                    `<span class="badge bg-warning">Keine Aktivität</span>`}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="p-3 border rounded">
                                            <h6>🌐 Domain Extraction</h6>
                                            <small class="text-muted">Alle 12 Stunden</small>
                                            <div class="mt-2">
                                                ${cronStatus.rows[0].last_domain_run ? 
                                                    `<span class="badge bg-success">Aktiv</span>
                                                     <div class="small text-muted">Letzter Lauf: ${new Date(cronStatus.rows[0].last_domain_run).toLocaleTimeString('de-DE')}</div>` :
                                                    `<span class="badge bg-warning">Keine Aktivität</span>`}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="p-3 border rounded">
                                            <h6>📊 API Resources</h6>
                                            <small class="text-muted">System Limits</small>
                                            <div class="mt-2">
                                                <div class="mb-2">
                                                    <small class="text-muted">2captcha:</small>
                                                    <button onclick="checkBalance()" class="btn btn-sm btn-primary btn-sm">Check</button>
                                                    <div id="balance-info" class="small"></div>
                                                </div>
                                                <div>
                                                    <small class="text-muted">Google API:</small>
                                                    <button onclick="checkGoogleUsage()" class="btn btn-sm btn-info btn-sm">Check</button>
                                                    <button onclick="testGoogleQuota()" class="btn btn-sm btn-warning btn-sm" title="Make test API call">Test</button>
                                                    <div id="google-usage-info" class="small"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Recent Activity -->
                        <div class="row g-4">
                            <div class="col-md-6">
                                <div class="card">
                                    <div class="card-header">
                                        <h6>📅 Letzte Scanning-Aktivität</h6>
                                    </div>
                                    <div class="card-body">
                                        <div class="table-responsive">
                                            <table class="table table-sm">
                                                <thead>
                                                    <tr>
                                                        <th>Datum</th>
                                                        <th>Jobs gescannt</th>
                                                        <th>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${recentScans.rows.map(row => `
                                                        <tr>
                                                            <td>${new Date(row.scan_date).toLocaleDateString('de-DE')}</td>
                                                            <td>${row.jobs_scanned}</td>
                                                            <td><span class="badge bg-success">Aktiv</span></td>
                                                        </tr>
                                                    `).join('')}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>

                        function checkBalance() {
                            document.getElementById('balance-info').innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
                            fetch('/api/check-balance')
                                .then(response => response.json())
                                .then(data => {
                                    const balanceInfo = document.getElementById('balance-info');
                                    if (data.success) {
                                        balanceInfo.innerHTML = 
                                            '<div class="text-' + (data.balance >= 5 ? 'success' : 'danger') + ' fw-bold">' +
                                                '$' + data.balance.toFixed(2) +
                                            '</div>';
                                    } else {
                                        balanceInfo.innerHTML = '<div class="text-danger">Fehler</div>';
                                    }
                                })
                                .catch(error => {
                                    document.getElementById('balance-info').innerHTML = '<div class="text-danger">Fehler</div>';
                                });
                        }

                        function checkGoogleUsage() {
                            document.getElementById('google-usage-info').innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
                            fetch('/api/google-usage')
                                .then(response => response.json())
                                .then(data => {
                                    const usageInfo = document.getElementById('google-usage-info');
                                    if (data.success) {
                                        let colorClass = 'success';
                                        if (data.usage_percentage >= 100) colorClass = 'danger';
                                        else if (data.usage_percentage >= 80) colorClass = 'warning';
                                        else if (data.usage_percentage >= 50) colorClass = 'info';
                                        
                                        const sourceIndicator = data.source === 'real-time' ? 
                                            '<span class="badge bg-success ms-1" style="font-size: 9px;">LIVE</span>' : 
                                            '<span class="badge bg-secondary ms-1" style="font-size: 9px;">DB</span>';
                                        
                                        usageInfo.innerHTML = 
                                            '<div class="mt-1">' +
                                                '<div class="text-' + colorClass + ' small fw-bold">' +
                                                    data.queries_used + '/' + data.daily_limit + ' (' + data.usage_percentage + '%)' +
                                                    sourceIndicator +
                                                '</div>' +
                                                '<div class="progress" style="height: 10px;">' +
                                                    '<div class="progress-bar bg-' + colorClass + '" style="width: ' + data.usage_percentage + '%"></div>' +
                                                '</div>' +
                                                (data.last_query_time ? 
                                                    '<div class="text-muted" style="font-size: 11px;">Last: ' + 
                                                    new Date(data.last_query_time).toLocaleTimeString('de-DE') + '</div>' : '') +
                                            '</div>';
                                    } else {
                                        usageInfo.innerHTML = '<div class="text-muted small">No data</div>';
                                    }
                                })
                                .catch(error => {
                                    document.getElementById('google-usage-info').innerHTML = '<div class="text-danger small">Error</div>';
                                });
                        }

                        function testGoogleQuota() {
                            if (!confirm('This will make a real Google API call and use 1 query from your quota. Continue?')) {
                                return;
                            }
                            
                            document.getElementById('google-usage-info').innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> Testing...';
                            
                            fetch('/api/test-google-quota', { method: 'POST' })
                                .then(response => response.json())
                                .then(data => {
                                    if (data.success) {
                                        alert('Google API test successful! Check console for header details.');
                                        console.log('Google API Quota State:', data.quotaState);
                                        checkGoogleUsage(); // Refresh the display
                                    } else {
                                        alert('Test failed: ' + (data.error || 'Unknown error'));
                                    }
                                })
                                .catch(error => {
                                    alert('Test error: ' + error.message);
                                });
                        }

                        // Auto-refresh every 30 seconds
                        setInterval(function() {
                            window.location.reload();
                        }, 30000);
                    </script>
                </body>
                </html>
            `);

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('<h1>Dashboard Fehler</h1><p>' + error.message + '</p>');
    }
});

// Email search route - serve the email interface directly
app.get('/email-search', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN jd.best_email IS NOT NULL THEN 1 END) as jobs_with_emails,
                    COUNT(DISTINCT jd.company_domain) as unique_domains,
                    COUNT(DISTINCT j.beruf) as unique_job_types,
                    COUNT(DISTINCT j.arbeitsort_plz) as unique_locations
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
            const stats = await client.query(statsQuery);
            
            const jobTypesQuery = `
                SELECT beruf, COUNT(*) as count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                INNER JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true 
                AND jd.best_email IS NOT NULL 
                AND jd.scraping_success = true
                AND j.beruf IS NOT NULL
                GROUP BY beruf
                ORDER BY count DESC
                LIMIT 10
            `;
            const jobTypes = await client.query(jobTypesQuery);
            
            res.send(`<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email-Adressen Suche - Job Scraper</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
</head>
<body>
    <nav class="navbar navbar-dark bg-dark">
        <div class="container">
            <a href="/" class="navbar-brand">
                <i class="bi bi-house"></i> Dashboard
            </a>
            <span class="navbar-brand mb-0 h1">
                <i class="bi bi-envelope-at"></i> Email-Adressen Suche
            </span>
        </div>
    </nav>
    
    <div class="container mt-4">
        <h1 class="text-center mb-4">
            <i class="bi bi-search"></i> Email-Adressen aus Stellenanzeigen
        </h1>
        <p class="text-center mb-4">Search and extract email addresses from job listings</p>
        
        <!-- Search Form -->
        <div class="card mb-4">
            <div class="card-header">
                <h5 class="mb-0"><i class="bi bi-funnel"></i> Suchfilter</h5>
            </div>
            <div class="card-body">
                <form id="searchForm">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label for="jobType" class="form-label">Beruf / Stichwort</label>
                            <input type="text" class="form-control" id="jobType" name="jobType" placeholder="z.B. Fleischer, Bäcker, Verkäufer">
                        </div>
                        <div class="col-md-6">
                            <label for="location" class="form-label">Ort / PLZ</label>
                            <input type="text" class="form-control" id="location" name="location" placeholder="z.B. Berlin, 10115">
                        </div>
                        <div class="col-md-6">
                            <label for="company" class="form-label">Unternehmen</label>
                            <input type="text" class="form-control" id="company" name="company" placeholder="z.B. REWE, Edeka">
                        </div>
                        <div class="col-md-6">
                            <label for="emailDomain" class="form-label">Email-Domain</label>
                            <input type="text" class="form-control" id="emailDomain" name="emailDomain" placeholder="z.B. @rewe.de">
                        </div>
                    </div>
                    
                    <div class="row g-3 mt-3">
                        <div class="col-md-4">
                            <label for="jobCategory" class="form-label">Stellenart</label>
                            <select class="form-select" id="jobCategory" name="jobCategory">
                                <option value="">Alle Stellenarten</option>
                                <option value="ausbildung">Nur Ausbildungen</option>
                                <option value="job">Nur Jobs (keine Ausbildungen)</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label for="externalUrl" class="form-label">Externe URL</label>
                            <select class="form-select" id="externalUrl" name="externalUrl">
                                <option value="">Alle Jobs</option>
                                <option value="with_external">Nur mit externer URL</option>
                                <option value="without_external" selected>Nur ohne externe URL</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label for="emailFilter" class="form-label">Email-Status</label>
                            <select class="form-select" id="emailFilter" name="emailFilter">
                                <option value="">Alle Jobs anzeigen</option>
                                <option value="with_emails">Nur Jobs mit Email-Adressen</option>
                                <option value="without_emails">Nur Jobs ohne Email-Adressen</option>
                            </select>
                        </div>
                        <div class="col-12">
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" id="groupByEmployer" name="groupByEmployer" checked>
                                <label class="form-check-label" for="groupByEmployer">
                                    <strong>Nach Arbeitgeber gruppieren (eine Email pro Firma)</strong>
                                    <small class="text-muted d-block">Zeigt nur eine Email-Adresse pro Arbeitgeber an, verhindert Duplikate</small>
                                </label>
                            </div>
                            <div class="form-check mb-3">
                                <input class="form-check-input" type="checkbox" id="headlessMode" name="headlessMode" checked>
                                <label class="form-check-label" for="headlessMode">
                                    <strong>Headless Mode für Email-Extraktion</strong>
                                    <small class="text-muted d-block">Browser unsichtbar ausführen (empfohlen). Deaktivieren für visuelle Kontrolle.</small>
                                </label>
                            </div>
                            <button type="submit" class="btn btn-primary me-2">
                                <i class="bi bi-search"></i> Suchen
                            </button>
                            <button type="button" class="btn btn-outline-secondary" onclick="clearForm()">
                                <i class="bi bi-arrow-clockwise"></i> Zurücksetzen
                            </button>
                            <button type="button" class="btn btn-success ms-2" onclick="exportResults('csv')" id="exportBtn" style="display:none;">
                                <i class="bi bi-file-earmark-spreadsheet"></i> CSV Export
                            </button>
                            <button type="button" class="btn btn-warning ms-2" onclick="startEmailExtraction()" id="extractBtn" style="display:none;">
                                <i class="bi bi-envelope-plus"></i> Email-Extraktion starten
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>

        <!-- Results placeholder -->
        <div id="resultsSection" style="display: none;">
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> Suchergebnisse werden hier angezeigt
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        let lastSearchResults = [];

        // Handle form submission
        document.getElementById('searchForm').addEventListener('submit', function(e) {
            e.preventDefault();
            performSearch();
        });

        async function performSearch() {
            const formData = new FormData(document.getElementById('searchForm'));
            const searchData = {
                jobType: formData.get('jobType') || '',
                location: formData.get('location') || '',
                company: formData.get('company') || '',
                emailDomain: formData.get('emailDomain') || '',
                jobCategory: formData.get('jobCategory') || '',
                externalUrl: formData.get('externalUrl') || '',
                emailFilter: formData.get('emailFilter') || '',
                groupByEmployer: formData.get('groupByEmployer') === 'on',
                page: 1,
                pageSize: 50
            };

            console.log('Search data:', searchData);

            try {
                const response = await fetch('/api/search-emails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(searchData)
                });

                const data = await response.json();
                console.log('Search results:', data);

                if (data.success) {
                    lastSearchResults = data.results || [];
                    displayResults(data.results || [], data.totalResults || 0, data.currentPage || 1);
                    
                    // Show export and extraction buttons if we have results
                    const exportBtn = document.getElementById('exportBtn');
                    const extractBtn = document.getElementById('extractBtn');
                    
                    if (exportBtn && data.results && data.results.length > 0) {
                        exportBtn.style.display = 'inline-block';
                    }
                    
                    if (extractBtn && data.results && data.results.length > 0) {
                        const jobsWithoutEmails = data.results.filter(job => !job.best_email || job.best_email.trim() === '');
                        extractBtn.style.display = jobsWithoutEmails.length > 0 ? 'inline-block' : 'none';
                    }
                } else {
                    alert('Fehler bei der Suche: ' + (data.error || 'Unbekannter Fehler'));
                }
            } catch (error) {
                console.error('Search error:', error);
                alert('Fehler bei der Suche: ' + error.message);
            }
        }

        function displayResults(results, totalResults, currentPage) {
            const resultsSection = document.getElementById('resultsSection');
            
            if (!results || results.length === 0) {
                resultsSection.innerHTML = '<div class="alert alert-warning"><i class="bi bi-exclamation-triangle"></i> Keine Ergebnisse gefunden</div>';
                resultsSection.style.display = 'block';
                return;
            }

            const pageInfo = totalResults > results.length ? 
                \` (Seite \${currentPage}, zeige \${results.length} von \${totalResults})\` : '';

            const html = \`
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">
                            <i class="bi bi-list-ul"></i> Suchergebnisse 
                            <span class="badge bg-primary">\${totalResults} gefunden\${pageInfo}</span>
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead class="table-light">
                                    <tr>
                                        <th>Stellentitel</th>
                                        <th>Unternehmen</th>
                                        <th>Ort</th>
                                        <th>Email</th>
                                        <th>Datum</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    \${results.map(job => \`
                                        <tr>
                                            <td><strong>\${job.titel || 'N/A'}</strong></td>
                                            <td>\${job.arbeitgeber || 'N/A'}</td>
                                            <td>\${job.arbeitsort_ort || 'N/A'}</td>
                                            <td>
                                                \${job.best_email ? 
                                                    \`<span class="text-success"><i class="bi bi-envelope-check"></i> \${job.best_email}</span>\` : 
                                                    '<span class="text-muted"><i class="bi bi-envelope-x"></i> Keine Email</span>'
                                                }
                                            </td>
                                            <td class="text-muted small">\${job.modifikationstimestamp ? new Date(job.modifikationstimestamp).toLocaleDateString('de-DE') : 'N/A'}</td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            \`;

            resultsSection.innerHTML = html;
            resultsSection.style.display = 'block';
        }

        function clearForm() {
            document.getElementById('searchForm').reset();
            document.getElementById('resultsSection').style.display = 'none';
            document.getElementById('exportBtn').style.display = 'none';
            document.getElementById('extractBtn').style.display = 'none';
            lastSearchResults = [];
        }

        async function startEmailExtraction() {
            // Get search parameters from form
            const formData = new FormData(document.getElementById('searchForm'));
            const searchData = {
                jobType: formData.get('jobType') || '',
                location: formData.get('location') || '',
                company: formData.get('company') || '',
                emailDomain: formData.get('emailDomain') || '',
                jobCategory: formData.get('jobCategory') || '',
                externalUrl: formData.get('externalUrl') || '',
                emailFilter: formData.get('emailFilter') || '',
                groupByEmployer: formData.get('groupByEmployer') === 'on'
            };
            
            // Fetch ALL jobs without pagination limit
            try {
                const response = await fetch('/api/search-emails-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(searchData)
                });
                
                const data = await response.json();
                
                if (!data.success || !data.results || data.results.length === 0) {
                    alert('Keine Jobs ohne Email-Adressen gefunden.');
                    return;
                }
                
                const jobsWithoutEmails = data.results.filter(job => !job.best_email || job.best_email.trim() === '');
                
                if (jobsWithoutEmails.length === 0) {
                    alert('Alle gefundenen Jobs haben bereits Email-Adressen.');
                    return;
                }
                
                const message = 'Email-Extraktion für ALLE ' + jobsWithoutEmails.length + ' Jobs starten?';
                
                if (confirm(message)) {
                    const refNumbers = jobsWithoutEmails.map(job => job.refnr);
                    const headlessMode = document.getElementById('headlessMode').checked;
                    
                    fetch('/api/start-targeted-extraction', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            refNumbers: refNumbers,
                            headlessMode: headlessMode
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // Simply refresh results after a short delay
                            setTimeout(() => {
                                performSearch();
                            }, 2000);
                        } else {
                            alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
                        }
                    })
                    .catch(error => {
                        alert('Fehler: ' + error.message);
                    });
                }
            } catch (error) {
                alert('Fehler beim Abrufen der Jobs: ' + error.message);
            }
        }

        function exportResults(format) {
            if (!lastSearchResults || lastSearchResults.length === 0) {
                alert('Keine Suchergebnisse zum Exportieren vorhanden.');
                return;
            }
            
            // Get current search parameters from form
            const formData = new FormData(document.getElementById('searchForm'));
            const searchParams = new URLSearchParams();
            
            searchParams.append('jobType', formData.get('jobType') || '');
            searchParams.append('location', formData.get('location') || '');
            searchParams.append('company', formData.get('company') || '');
            searchParams.append('emailDomain', formData.get('emailDomain') || '');
            searchParams.append('jobCategory', formData.get('jobCategory') || '');
            searchParams.append('externalUrl', formData.get('externalUrl') || '');
            searchParams.append('emailFilter', formData.get('emailFilter') || '');
            searchParams.append('groupByEmployer', formData.get('groupByEmployer') === 'on');
            
            // Open export URL in new window to download
            window.open('/api/export-emails-csv?' + searchParams.toString(), '_blank');
        }
    </script>
</body>
</html>`);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Email search error:', error);
        res.status(500).send('<h1>Email Search Fehler</h1><p>' + error.message + '</p>');
    }
});

// Scraper Control Interface
app.get('/scraper-control', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get system statistics grouped by employer
            const statsQuery = `
                WITH employer_status AS (
                    SELECT 
                        j.arbeitgeber,
                        MAX(CASE WHEN j.externeurl IS NOT NULL AND j.externeurl != '' THEN 1 ELSE 0 END) as has_external_url,
                        MAX(CASE WHEN jd.best_email IS NOT NULL THEN 1 ELSE 0 END) as has_email,
                        MAX(CASE WHEN jd.reference_number IS NOT NULL THEN 1 ELSE 0 END) as has_been_scraped,
                        COUNT(*) as job_count
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                    WHERE j.is_active = true
                    GROUP BY j.arbeitgeber
                )
                SELECT 
                    COUNT(*) as total_employers,
                    COUNT(CASE WHEN has_email = 1 THEN 1 END) as employers_with_emails,
                    COUNT(CASE WHEN has_external_url = 1 THEN 1 END) as employers_with_external_urls,
                    COUNT(CASE WHEN has_external_url = 0 AND has_been_scraped = 0 THEN 1 END) as employers_ready_for_extraction,
                    (SELECT MAX(scraped_at) FROM job_scrp_arbeitsagentur_jobs_v2 WHERE is_active = true) as last_job_scraped,
                    (SELECT MAX(scraped_at) FROM job_scrp_job_details) as last_email_scraped
                FROM employer_status
            `;
            const stats = await client.query(statsQuery);
            
            // Get recent scraping activity
            const recentQuery = `
                SELECT 
                    DATE(scraped_at) as scrape_date,
                    COUNT(*) as jobs_scraped
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE scraped_at > NOW() - INTERVAL '7 days'
                GROUP BY DATE(scraped_at)
                ORDER BY scrape_date DESC
                LIMIT 7
            `;
            const recentActivity = await client.query(recentQuery);
            
            // Get additional statistics for display
            const additionalStatsQuery = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN jd.best_email IS NOT NULL THEN 1 END) as jobs_with_emails
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
            const additionalStats = await client.query(additionalStatsQuery);
            
            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Scraper-Steuerung - Job Scraper</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
                    <style>
                        .control-card {
                            border: none;
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            transition: transform 0.2s;
                        }
                        .control-card:hover {
                            transform: translateY(-2px);
                        }
                        .stats-header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 2rem 0;
                        }
                        .status-indicator {
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            display: inline-block;
                            margin-right: 8px;
                        }
                        .status-running { background-color: #28a745; }
                        .status-stopped { background-color: #dc3545; }
                        .status-idle { background-color: #ffc107; }
                    </style>
                </head>
                <body>
                    <nav class="navbar navbar-dark bg-dark">
                        <div class="container">
                            <a href="/" class="navbar-brand">
                                <i class="bi bi-house"></i> Dashboard
                            </a>
                            <span class="navbar-brand mb-0 h1">
                                <i class="bi bi-gear"></i> Scraper-Steuerung
                            </span>
                            <a href="/email-search" class="btn btn-outline-light btn-sm">
                                <i class="bi bi-envelope-at"></i> Email-Suche
                            </a>
                        </div>
                    </nav>

                    <div class="stats-header">
                        <div class="container">
                            <h1 class="text-center mb-4">
                                <i class="bi bi-robot"></i> Scraper-Steuerung & Monitoring
                            </h1>
                            <div class="row g-4">
                                <div class="col-md-3">
                                    <div class="text-center">
                                        <h3>${Number(stats.rows[0].total_employers).toLocaleString()}</h3>
                                        <p>Arbeitgeber gesamt</p>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="text-center">
                                        <h3>${Number(stats.rows[0].employers_with_emails).toLocaleString()}</h3>
                                        <p>Mit Email-Adressen</p>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="text-center">
                                        <h3>${Number(stats.rows[0].employers_ready_for_extraction).toLocaleString()}</h3>
                                        <p>Bereit für Email-Extraktion</p>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="text-center">
                                        <h3>${Number(stats.rows[0].employers_with_external_urls).toLocaleString()}</h3>
                                        <p>Externe URLs</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="container mt-4">
                        <!-- System Status -->
                        <div class="row g-4 mb-4">
                            <div class="col-md-12">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h5 class="mb-0"><i class="bi bi-activity"></i> System Status</h5>
                                    </div>
                                    <div class="card-body">
                                        <div class="row">
                                            <div class="col-md-4">
                                                <p><span class="status-indicator status-idle"></span>Job Scraper: <strong>Idle</strong></p>
                                                <small class="text-muted">Letzter Scan: ${stats.rows[0].last_job_scraped ? new Date(stats.rows[0].last_job_scraped).toLocaleString('de-DE') : 'Nie'}</small>
                                            </div>
                                            <div class="col-md-4">
                                                <p><span class="status-indicator status-idle"></span>Email Extraktor: <strong>Idle</strong></p>
                                                <small class="text-muted">Letzte Extraktion: ${stats.rows[0].last_email_scraped ? new Date(stats.rows[0].last_email_scraped).toLocaleString('de-DE') : 'Nie'}</small>
                                            </div>
                                            <div class="col-md-4">
                                                <p><span class="status-indicator status-running"></span>Dashboard: <strong>Running</strong></p>
                                                <small class="text-muted">Port 3001 aktiv</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Control Actions -->
                        <div class="row g-4 mb-4">
                            <div class="col-md-4">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h6 class="mb-0"><i class="bi bi-download"></i> Job Scraping</h6>
                                    </div>
                                    <div class="card-body">
                                        <p class="card-text">Neue Jobs von der Arbeitsagentur-API laden</p>
                                        <button class="btn btn-primary btn-sm me-2" onclick="startJobScraping()">
                                            <i class="bi bi-play"></i> Job-Scraping starten
                                        </button>
                                        <button class="btn btn-outline-secondary btn-sm" onclick="viewScrapingConfig()">
                                            <i class="bi bi-gear"></i> Konfiguration
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h6 class="mb-0"><i class="bi bi-envelope-plus"></i> Email-Extraktion</h6>
                                    </div>
                                    <div class="card-body">
                                        <p class="card-text">Email-Adressen aus Job-Details extrahieren</p>
                                        <div class="btn-group-vertical w-100">
                                            <div class="alert alert-warning" role="alert">
                                                <i class="bi bi-exclamation-triangle"></i> This functionality has been deprecated. Please use the email extraction features in the admin mode instead.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h6 class="mb-0"><i class="bi bi-database"></i> Datenbank</h6>
                                    </div>
                                    <div class="card-body">
                                        <p class="card-text">Datenbank-Wartung und -Statistiken</p>
                                        <button class="btn btn-info btn-sm me-2" onclick="showDatabaseStats()">
                                            <i class="bi bi-bar-chart"></i> Statistiken
                                        </button>
                                        <button class="btn btn-outline-warning btn-sm" onclick="cleanupDatabase()">
                                            <i class="bi bi-trash"></i> Cleanup
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Recent Activity -->
                        <div class="row g-4">
                            <div class="col-md-6">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h6 class="mb-0"><i class="bi bi-clock-history"></i> Letzte Scraping-Aktivität</h6>
                                    </div>
                                    <div class="card-body">
                                        ${recentActivity.rows.length > 0 ? `
                                            <div class="table-responsive">
                                                <table class="table table-sm">
                                                    <thead>
                                                        <tr>
                                                            <th>Datum</th>
                                                            <th>Jobs gescannt</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        ${recentActivity.rows.map(row => `
                                                            <tr>
                                                                <td>${new Date(row.scrape_date).toLocaleDateString('de-DE')}</td>
                                                                <td><span class="badge bg-primary">${row.jobs_scraped}</span></td>
                                                            </tr>
                                                        `).join('')}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ` : '<p class="text-muted">Keine Aktivität in den letzten 7 Tagen</p>'}
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="card control-card">
                                    <div class="card-header">
                                        <h6 class="mb-0"><i class="bi bi-list-task"></i> Aktuelle Aufgaben</h6>
                                    </div>
                                    <div class="card-body">
                                        <div id="taskList">
                                            <p class="text-muted">Keine aktiven Aufgaben</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        function startJobScraping() {
                            if (confirm('Job-Scraping starten? Dies kann einige Zeit dauern.')) {
                                showMessage('Job-Scraping wird gestartet...', 'info');
                                // TODO: Implement job scraping start
                                setTimeout(() => {
                                    showMessage('Job-Scraping gestartet! Überwachung im System Status.', 'success');
                                }, 1000);
                            }
                        }


                        function showDatabaseStats() {
                            showMessage('Lade Datenbankstatistiken...', 'info');
                            // TODO: Implement detailed database statistics
                        }

                        function cleanupDatabase() {
                            if (confirm('Datenbank-Cleanup ausführen? Dies entfernt veraltete und doppelte Einträge.')) {
                                showMessage('Database Cleanup wird ausgeführt...', 'warning');
                                // TODO: Implement database cleanup
                            }
                        }

                        function viewScrapingConfig() {
                            showMessage('Scraping-Konfiguration wird geladen...', 'info');
                            // TODO: Implement configuration view
                        }

                        function showMessage(message, type) {
                            // Create alert at top of page
                            const alertDiv = document.createElement('div');
                            alertDiv.className = \`alert alert-\${type} alert-dismissible fade show position-fixed\`;
                            alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 1050; max-width: 400px;';
                            alertDiv.innerHTML = \`
                                \${message}
                                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                            \`;
                            document.body.appendChild(alertDiv);
                            
                            // Auto-remove after 5 seconds
                            setTimeout(() => {
                                if (alertDiv.parentNode) {
                                    alertDiv.remove();
                                }
                            }, 5000);
                        }

                        function updateTaskList(task) {
                            const taskList = document.getElementById('taskList');
                            taskList.innerHTML = \`
                                <div class="d-flex justify-content-between align-items-center">
                                    <span><i class="bi bi-gear-fill text-primary"></i> \${task}</span>
                                    <span class="badge bg-primary">Läuft</span>
                                </div>
                            \`;
                        }

                        // Refresh status every 30 seconds
                        setInterval(() => {
                            // TODO: Implement real-time status updates
                        }, 30000);
                    </script>
                </body>
                </html>
            `);
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Scraper control error:', error);
        res.status(500).send('<h1>Scraper Control Fehler</h1><p>' + error.message + '</p>');
    }
});

// Job search API - shows all jobs with option to extract emails
app.post('/api/search-emails', async (req, res) => {
    try {
        const { jobType, location, company, emailDomain, emailFilter, groupByEmployer, jobCategory, externalUrl, page, pageSize } = req.body;
        const currentPage = parseInt(page) || 1;
        const itemsPerPage = parseInt(pageSize) || 50;
        const offset = (currentPage - 1) * itemsPerPage;
        
        let query;
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // Grouped query: one result per employer
            query = `
                SELECT 
                    MAX(j.refnr) as refnr,
                    MAX(j.titel) as titel,
                    MAX(j.beruf) as beruf,
                    j.arbeitgeber,
                    MAX(j.arbeitsort_ort) as arbeitsort_ort,
                    MAX(j.arbeitsort_plz) as arbeitsort_plz,
                    MAX(j.externeurl) as externeurl,
                    COALESCE(
                        MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END),
                        ''
                    ) as best_email,
                    MAX(jd.company_domain) as company_domain,
                    BOOL_OR(jd.scraping_success) as scraping_success,
                    MAX(jd.email_source) as email_source,
                    MAX(j.aktuelleveroeffentlichungsdatum) as aktuelleveroeffentlichungsdatum,
                    COUNT(j.refnr) as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        } else {
            // Regular query: all individual jobs
            query = `
                SELECT DISTINCT
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    jd.best_email,
                    jd.company_domain,
                    jd.scraping_success,
                    jd.email_source,
                    j.aktuelleveroeffentlichungsdatum,
                    1 as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        }
        
        const params = [];
        let paramIndex = 1;
        
        // Email filter option
        if (emailFilter === 'with_emails') {
            query += ` AND jd.best_email IS NOT NULL AND jd.best_email LIKE '%@%' AND jd.scraping_success = true`;
        } else if (emailFilter === 'without_emails') {
            // Show jobs without valid email addresses
            query += ` AND (jd.best_email IS NULL OR jd.best_email NOT LIKE '%@%')`;
        }
        
        // Filter für externe URLs (normalerweise ausschließen für Email-Extraktion)
        if (emailDomain) {
            query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
        }
        
        if (jobType && jobType.trim()) {
            query += ` AND (LOWER(j.beruf) LIKE LOWER($${paramIndex}) OR LOWER(j.titel) LIKE LOWER($${paramIndex}))`;
            params.push(`%${jobType.trim()}%`);
            paramIndex++;
        }
        
        if (location && location.trim()) {
            query += ` AND (j.arbeitsort_plz = $${paramIndex} OR LOWER(j.arbeitsort_ort) LIKE LOWER($${paramIndex + 1}))`;
            params.push(location.trim(), `%${location.trim()}%`);
            paramIndex += 2;
        }
        
        if (company && company.trim()) {
            query += ` AND LOWER(j.arbeitgeber) LIKE LOWER($${paramIndex})`;
            params.push(`%${company.trim()}%`);
            paramIndex++;
        }
        
        if (emailDomain && emailDomain.trim()) {
            query += ` AND jd.company_domain LIKE $${paramIndex}`;
            params.push(`%${emailDomain.trim()}%`);
            paramIndex++;
        }
        
        if (jobCategory && jobCategory.trim()) {
            if (jobCategory === 'ausbildung') {
                // Ausbildung: contains ausbildung in title/beruf
                query += ` AND (LOWER(j.titel) LIKE '%ausbildung%' OR LOWER(j.beruf) LIKE '%ausbildung%')`;
            } else if (jobCategory === 'job') {
                // Regular jobs: doesn't contain ausbildung
                query += ` AND (LOWER(j.titel) NOT LIKE '%ausbildung%' AND LOWER(j.beruf) NOT LIKE '%ausbildung%')`;
            }
        }
        
        if (externalUrl && externalUrl.trim()) {
            if (externalUrl === 'with_external') {
                // Only jobs with external URLs
                query += ` AND j.externeurl IS NOT NULL AND j.externeurl != ''`;
            } else if (externalUrl === 'without_external') {
                // Only jobs without external URLs
                query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
            }
        }
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // When searching for jobs with emails, also group by email to avoid duplicates
            if (emailFilter === 'with_emails') {
                query += ` GROUP BY j.arbeitgeber, jd.best_email`;
                query += ` HAVING jd.best_email LIKE '%@%'`;
            } else {
                query += ` GROUP BY j.arbeitgeber`;
                // Filter groups with emails if required
                if (emailFilter === 'without_emails') {
                    query += ` HAVING MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END) IS NULL`;
                }
            }
            query += ` ORDER BY MAX(j.aktuelleveroeffentlichungsdatum) DESC LIMIT ${itemsPerPage} OFFSET ${offset}`;
        } else {
            query += ` ORDER BY j.aktuelleveroeffentlichungsdatum DESC LIMIT ${itemsPerPage} OFFSET ${offset}`;
        }
        
        // Create count query for total results with separate parameters
        let countQuery;
        const countParams = [];
        let countParamIndex = 1;
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // When counting with email filter, need to adjust SELECT to match grouping
            if (emailFilter === 'with_emails') {
                countQuery = `
                    SELECT COUNT(*) as total FROM (
                        SELECT j.arbeitgeber, jd.best_email
                        FROM job_scrp_arbeitsagentur_jobs_v2 j
                        LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                        WHERE j.is_active = true
                `;
            } else {
                countQuery = `
                    SELECT COUNT(*) as total FROM (
                        SELECT j.arbeitgeber
                        FROM job_scrp_arbeitsagentur_jobs_v2 j
                        LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                        WHERE j.is_active = true
                `;
            }
        } else {
            countQuery = `
                SELECT COUNT(DISTINCT j.refnr) as total
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        }
        
        // Apply same filters to count query with separate parameters
        if (emailFilter === 'with_emails') {
            countQuery += ` AND jd.best_email IS NOT NULL AND jd.best_email LIKE '%@%' AND jd.scraping_success = true`;
        } else if (emailFilter === 'without_emails') {
            // Show jobs without valid email addresses
            countQuery += ` AND (jd.best_email IS NULL OR jd.best_email NOT LIKE '%@%')`;
        }
        
        if (emailDomain) {
            countQuery += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
        }
        
        if (jobType && jobType.trim()) {
            countQuery += ` AND (LOWER(j.beruf) LIKE LOWER($${countParamIndex}) OR LOWER(j.titel) LIKE LOWER($${countParamIndex}))`;
            countParams.push(`%${jobType.trim()}%`);
            countParamIndex++;
        }
        
        if (location && location.trim()) {
            countQuery += ` AND (j.arbeitsort_plz = $${countParamIndex} OR LOWER(j.arbeitsort_ort) LIKE LOWER($${countParamIndex + 1}))`;
            countParams.push(location.trim(), `%${location.trim()}%`);
            countParamIndex += 2;
        }
        
        if (company && company.trim()) {
            countQuery += ` AND LOWER(j.arbeitgeber) LIKE LOWER($${countParamIndex})`;
            countParams.push(`%${company.trim()}%`);
            countParamIndex++;
        }
        
        if (emailDomain && emailDomain.trim()) {
            countQuery += ` AND jd.company_domain LIKE $${countParamIndex}`;
            countParams.push(`%${emailDomain.trim()}%`);
            countParamIndex++;
        }
        
        if (jobCategory && jobCategory.trim()) {
            if (jobCategory === 'ausbildung') {
                // Ausbildung: contains ausbildung in title/beruf
                countQuery += ` AND (LOWER(j.titel) LIKE '%ausbildung%' OR LOWER(j.beruf) LIKE '%ausbildung%')`;
            } else if (jobCategory === 'job') {
                // Regular jobs: doesn't contain ausbildung
                countQuery += ` AND (LOWER(j.titel) NOT LIKE '%ausbildung%' AND LOWER(j.beruf) NOT LIKE '%ausbildung%')`;
            }
        }
        
        if (externalUrl && externalUrl.trim()) {
            if (externalUrl === 'with_external') {
                // Only jobs with external URLs
                countQuery += ` AND j.externeurl IS NOT NULL AND j.externeurl != ''`;
            } else if (externalUrl === 'without_external') {
                // Only jobs without external URLs
                countQuery += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
            }
        }
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // Match the grouping logic from main query
            if (emailFilter === 'with_emails') {
                countQuery += ` GROUP BY j.arbeitgeber, jd.best_email`;
                countQuery += ` HAVING jd.best_email LIKE '%@%'`;
            } else {
                countQuery += ` GROUP BY j.arbeitgeber`;
                if (emailFilter === 'without_emails') {
                    countQuery += ` HAVING MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END) IS NULL`;
                }
            }
            countQuery += `) subquery`;
        }
        
        // Execute both queries with their respective parameters
        const [result, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams)
        ]);
        
        const totalResults = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(totalResults / itemsPerPage);
        
        
        res.json({
            success: true,
            results: result.rows,
            count: result.rows.length,
            totalResults: totalResults,
            currentPage: currentPage,
            totalPages: totalPages,
            pageSize: itemsPerPage,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1,
            grouped: groupByEmployer === true || groupByEmployer === 'true',
            message: result.rows.length === 0 && emailFilter === 'with_emails' ? 
                'Keine Jobs mit Email-Adressen gefunden. Starten Sie die Email-Extraktion für diese Jobs.' : null
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to get ALL search results without pagination
app.post('/api/search-emails-all', async (req, res) => {
    try {
        const { jobType, location, company, emailDomain, emailFilter, groupByEmployer, jobCategory, externalUrl } = req.body;
        
        let query;
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // Grouped query: one result per employer
            query = `
                SELECT 
                    MAX(j.refnr) as refnr,
                    MAX(j.titel) as titel,
                    MAX(j.beruf) as beruf,
                    j.arbeitgeber,
                    MAX(j.arbeitsort_ort) as arbeitsort_ort,
                    MAX(j.arbeitsort_plz) as arbeitsort_plz,
                    MAX(j.externeurl) as externeurl,
                    COALESCE(
                        MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END),
                        ''
                    ) as best_email,
                    MAX(jd.company_domain) as company_domain,
                    BOOL_OR(jd.scraping_success) as scraping_success,
                    MAX(jd.email_source) as email_source,
                    MAX(j.aktuelleveroeffentlichungsdatum) as aktuelleveroeffentlichungsdatum,
                    COUNT(j.refnr) as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        } else {
            // Regular query: all individual jobs
            query = `
                SELECT DISTINCT
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    jd.best_email,
                    jd.company_domain,
                    jd.scraping_success,
                    jd.email_source,
                    j.aktuelleveroeffentlichungsdatum,
                    1 as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        }
        
        const params = [];
        let paramIndex = 1;
        
        // Email filter option
        if (emailFilter === 'with_emails') {
            query += ` AND jd.best_email IS NOT NULL AND jd.best_email LIKE '%@%' AND jd.scraping_success = true`;
        } else if (emailFilter === 'without_emails') {
            // Show jobs without valid email addresses
            query += ` AND (jd.best_email IS NULL OR jd.best_email NOT LIKE '%@%')`;
        }
        
        // Filter für externe URLs (normalerweise ausschließen für Email-Extraktion)
        if (emailDomain) {
            query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
        }
        
        if (jobType && jobType.trim()) {
            query += ` AND (LOWER(j.beruf) LIKE LOWER($${paramIndex}) OR LOWER(j.titel) LIKE LOWER($${paramIndex}))`;
            params.push(`%${jobType.trim()}%`);
            paramIndex++;
        }
        
        if (location && location.trim()) {
            query += ` AND (j.arbeitsort_plz = $${paramIndex} OR LOWER(j.arbeitsort_ort) LIKE LOWER($${paramIndex + 1}))`;
            params.push(location.trim(), `%${location.trim()}%`);
            paramIndex += 2;
        }
        
        if (company && company.trim()) {
            query += ` AND LOWER(j.arbeitgeber) LIKE LOWER($${paramIndex})`;
            params.push(`%${company.trim()}%`);
            paramIndex++;
        }
        
        if (emailDomain && emailDomain.trim()) {
            query += ` AND jd.company_domain LIKE $${paramIndex}`;
            params.push(`%${emailDomain.trim()}%`);
            paramIndex++;
        }
        
        if (jobCategory && jobCategory.trim()) {
            if (jobCategory === 'ausbildung') {
                // Ausbildung: contains ausbildung in title/beruf
                query += ` AND (LOWER(j.titel) LIKE '%ausbildung%' OR LOWER(j.beruf) LIKE '%ausbildung%')`;
            } else if (jobCategory === 'job') {
                // Regular jobs: doesn't contain ausbildung
                query += ` AND (LOWER(j.titel) NOT LIKE '%ausbildung%' AND LOWER(j.beruf) NOT LIKE '%ausbildung%')`;
            }
        }
        
        if (externalUrl && externalUrl.trim()) {
            if (externalUrl === 'with_external') {
                // Only jobs with external URLs
                query += ` AND j.externeurl IS NOT NULL AND j.externeurl != ''`;
            } else if (externalUrl === 'without_external') {
                // Only jobs without external URLs
                query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
            }
        }
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // When searching for jobs with emails, also group by email to avoid duplicates
            if (emailFilter === 'with_emails') {
                query += ` GROUP BY j.arbeitgeber, jd.best_email`;
                query += ` HAVING jd.best_email LIKE '%@%'`;
            } else {
                query += ` GROUP BY j.arbeitgeber`;
                // Filter groups with emails if required
                if (emailFilter === 'without_emails') {
                    query += ` HAVING MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END) IS NULL`;
                }
            }
            query += ` ORDER BY MAX(j.aktuelleveroeffentlichungsdatum) DESC`;
        } else {
            query += ` ORDER BY j.aktuelleveroeffentlichungsdatum DESC`;
        }
        
        // No LIMIT - return ALL results
        
        const client = await pool.connect();
        try {
            const results = await client.query(query, params);
            
            res.json({
                success: true,
                results: results.rows,
                totalResults: results.rows.length
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Search all error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Export API - gets ALL matching results without pagination
app.get('/api/export-emails-csv', async (req, res) => {
    try {
        const { jobType, location, company, emailDomain, emailFilter, groupByEmployer, jobCategory, externalUrl } = req.query;
        
        let query;
        
        if (groupByEmployer === 'true' || groupByEmployer === true) {
            // Grouped query: one result per employer
            query = `
                SELECT 
                    MAX(j.refnr) as refnr,
                    MAX(j.titel) as titel,
                    MAX(j.beruf) as beruf,
                    j.arbeitgeber,
                    MAX(j.arbeitsort_ort) as arbeitsort_ort,
                    MAX(j.arbeitsort_plz) as arbeitsort_plz,
                    MAX(j.externeurl) as externeurl,
                    COALESCE(
                        MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END),
                        ''
                    ) as best_email,
                    MAX(jd.company_domain) as company_domain,
                    BOOL_OR(jd.scraping_success) as scraping_success,
                    MAX(jd.email_source) as email_source,
                    MAX(j.aktuelleveroeffentlichungsdatum) as aktuelleveroeffentlichungsdatum,
                    COUNT(j.refnr) as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        } else {
            // Regular query: all individual jobs
            query = `
                SELECT DISTINCT
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    jd.best_email,
                    jd.company_domain,
                    jd.scraping_success,
                    jd.email_source,
                    j.aktuelleveroeffentlichungsdatum,
                    1 as job_count
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.is_active = true
            `;
        }
        
        const params = [];
        let paramIndex = 1;
        
        // Apply same filters as search
        if (emailFilter === 'with_emails') {
            query += ` AND jd.best_email IS NOT NULL AND jd.best_email LIKE '%@%' AND jd.scraping_success = true`;
        } else if (emailFilter === 'without_emails') {
            // Show jobs without valid email addresses
            query += ` AND (jd.best_email IS NULL OR jd.best_email NOT LIKE '%@%')`;
        }
        
        if (emailDomain) {
            query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
        }
        
        if (jobType && jobType.trim()) {
            query += ` AND (LOWER(j.beruf) LIKE LOWER($${paramIndex}) OR LOWER(j.titel) LIKE LOWER($${paramIndex}))`;
            params.push(`%${jobType.trim()}%`);
            paramIndex++;
        }
        
        if (location && location.trim()) {
            query += ` AND (j.arbeitsort_plz = $${paramIndex} OR LOWER(j.arbeitsort_ort) LIKE LOWER($${paramIndex + 1}))`;
            params.push(location.trim(), `%${location.trim()}%`);
            paramIndex += 2;
        }
        
        if (company && company.trim()) {
            query += ` AND LOWER(j.arbeitgeber) LIKE LOWER($${paramIndex})`;
            params.push(`%${company.trim()}%`);
            paramIndex++;
        }
        
        if (emailDomain && emailDomain.trim()) {
            query += ` AND jd.company_domain LIKE $${paramIndex}`;
            params.push(`%${emailDomain.trim()}%`);
            paramIndex++;
        }
        
        if (jobCategory && jobCategory.trim()) {
            if (jobCategory === 'ausbildung') {
                // Ausbildung: contains ausbildung in title/beruf
                query += ` AND (LOWER(j.titel) LIKE '%ausbildung%' OR LOWER(j.beruf) LIKE '%ausbildung%')`;
            } else if (jobCategory === 'job') {
                // Regular jobs: doesn't contain ausbildung
                query += ` AND (LOWER(j.titel) NOT LIKE '%ausbildung%' AND LOWER(j.beruf) NOT LIKE '%ausbildung%')`;
            }
        }
        
        if (externalUrl && externalUrl.trim()) {
            if (externalUrl === 'with_external') {
                // Only jobs with external URLs
                query += ` AND j.externeurl IS NOT NULL AND j.externeurl != ''`;
            } else if (externalUrl === 'without_external') {
                // Only jobs without external URLs
                query += ` AND (j.externeurl IS NULL OR j.externeurl = '')`;
            }
        }
        
        if (groupByEmployer === true || groupByEmployer === 'true') {
            // Match the grouping logic from search query
            if (emailFilter === 'with_emails') {
                query += ` GROUP BY j.arbeitgeber, jd.best_email`;
                query += ` HAVING jd.best_email LIKE '%@%'`;
            } else {
                query += ` GROUP BY j.arbeitgeber`;
                if (emailFilter === 'without_emails') {
                    query += ` HAVING MAX(CASE WHEN jd.best_email LIKE '%@%' THEN jd.best_email END) IS NULL`;
                }
            }
            query += ` ORDER BY MAX(j.aktuelleveroeffentlichungsdatum) DESC`;
        } else {
            query += ` ORDER BY j.aktuelleveroeffentlichungsdatum DESC`;
        }
        
        const result = await pool.query(query, params);
        
        // Generate CSV
        const csvHeaders = 'Titel,Beruf,Firma,Ort,PLZ,Email,Domain,Email-Quelle,Anzahl-Jobs';
        const csvRows = result.rows.map(r => 
            `"${r.titel || ''}","${r.beruf || ''}","${r.arbeitgeber || ''}","${r.arbeitsort_ort || ''}","${r.arbeitsort_plz || ''}","${r.best_email || ''}","${r.company_domain || ''}","${r.email_source || ''}","${r.job_count || 1}"`
        );
        
        const csv = [csvHeaders, ...csvRows].join('\n');
        const filename = `email-export-${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv); // Add BOM for Excel compatibility
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// API to extract email for single job
app.post('/api/extract-single-email', async (req, res) => {
    try {
        const { refnr } = req.body;
        
        if (!refnr) {
            return res.status(400).json({
                success: false,
                error: 'Referenznummer erforderlich'
            });
        }
        
        // Check if job exists and doesn't have external URL
        const checkQuery = `
            SELECT refnr, externeurl 
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE refnr = $1 AND is_active = true
        `;
        
        const checkResult = await pool.query(checkQuery, [refnr]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Job nicht gefunden'
            });
        }
        
        if (checkResult.rows[0].externeurl) {
            return res.status(400).json({
                success: false,
                error: 'Job hat externe URL - Email-Extraktion nicht möglich'
            });
        }
        
        // Start extraction for this specific job
        const { spawn } = require('child_process');
        const process = spawn('node', ['-e', `
            const SimplifiedDetailScraper = require('./src/simplified-detail-scraper');
            const scraper = new SimplifiedDetailScraper();
            
            async function scrapeOne() {
                try {
                    await scraper.initializeBrowser();
                    const job = {
                        refnr: '${refnr}',
                        id: 0,
                        titel: 'Single Job Scrape',
                        arbeitgeber: 'Unknown',
                        arbeitsort_ort: 'Unknown'
                    };
                    
                    const result = await scraper.scrapeJobDetail(job);
                    await scraper.saveResults(job, result);
                    
                    console.log('Scraping completed for ${refnr}');
                } catch (error) {
                    console.error('Scraping failed:', error.message);
                } finally {
                    await scraper.cleanup();
                    process.exit(0);
                }
            }
            
            scrapeOne();
        `], {
            detached: true,
            stdio: 'ignore'
        });
        
        process.unref();
        
        res.json({
            success: true,
            message: `Email-Extraktion für Job ${refnr} gestartet`
        });
        
    } catch (error) {
        console.error('Single email extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API to extract emails for multiple targeted jobs
app.post('/api/start-targeted-extraction', async (req, res) => {
    try {
        const { refNumbers, headlessMode } = req.body;
        
        if (!refNumbers || !Array.isArray(refNumbers) || refNumbers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Array of reference numbers required'
            });
        }
        
        const client = await pool.connect();
        try {
            // Check which jobs exist and don't have external URLs
            const checkQuery = `
                SELECT refnr, externeurl, titel, arbeitgeber
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE refnr = ANY($1) AND is_active = true
            `;
            
            const checkResult = await client.query(checkQuery, [refNumbers]);
            
            // Filter out jobs with external URLs
            const validJobs = checkResult.rows.filter(job => !job.externeurl || job.externeurl.trim() === '');
            
            if (validJobs.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid jobs found for extraction (all have external URLs or do not exist)'
                });
            }
            
            // Create temporary file with reference numbers
            const fs = require('fs');
            const { spawn } = require('child_process');
            const crypto = require('crypto');
            
            // Generate unique filename
            const tempFileName = `refs_${crypto.randomBytes(8).toString('hex')}.txt`;
            const tempFilePath = path.join(__dirname, '..', 'python_scrapers', tempFileName);
            
            // Write reference numbers to temporary file
            const refNumbersToProcess = validJobs.map(job => job.refnr);
            fs.writeFileSync(tempFilePath, refNumbersToProcess.join('\n'));
            
            // Get unique employers from the valid jobs
            const uniqueEmployers = [...new Set(validJobs.map(job => job.arbeitgeber))];
            
            // Determine headless mode
            const headlessFlag = headlessMode !== false ? '--headless' : '';
            
            console.log(`Starting targeted extraction for ${refNumbersToProcess.length} jobs`);
            console.log(`Temp file: ${tempFilePath}`);
            console.log(`Headless mode: ${headlessMode}`);
            
            // Start targeted scraper with the reference numbers file
            const args = [
                'python_scrapers/targeted_scraper.py',
                '--refs-file', tempFilePath,  // Use full path instead of just filename
                '--worker-id', '99',
                '--delay', '0'
            ];
            
            if (headlessFlag) {
                args.push(headlessFlag);
            }
            
            console.log('Running command:', 'python3', args.join(' '));
            
            const extractionProcess = spawn('python3', args, {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: path.join(__dirname, '..')
            });
            
            // Log output for debugging
            extractionProcess.stdout.on('data', (data) => {
                console.log(`Scraper output: ${data}`);
            });
            
            extractionProcess.stderr.on('data', (data) => {
                console.error(`Scraper error: ${data}`);
            });
            
            extractionProcess.on('error', (error) => {
                console.error('Failed to start scraper:', error);
            });
            
            extractionProcess.unref();
            
            // Clean up temp file after a delay (give process time to read it)
            setTimeout(() => {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (e) {
                    console.error('Error deleting temp file:', e);
                }
            }, 5000);
            
            res.json({
                success: true,
                message: `Email extraction started for ${validJobs.length} specific jobs`,
                details: {
                    jobsToProcess: validJobs.length,
                    uniqueEmployers: uniqueEmployers.length,
                    totalRequested: refNumbers.length,
                    skipped: refNumbers.length - validJobs.length,
                    tempFile: tempFileName
                }
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Targeted email extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint for fetching job data
app.get('/api/job-detail/:refnr', async (req, res) => {
    try {
        const { refnr } = req.params;
        const client = await pool.connect();
        try {
            const jobQuery = `
                SELECT 
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    j.aktuelleveroeffentlichungsdatum,
                    j.eintrittsdatum,
                    jd.best_email,
                    jd.company_domain,
                    jd.email_source,
                    jd.scraping_success,
                    jd.scraped_at
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.refnr = $1 AND j.is_active = true
            `;
            const jobResult = await client.query(jobQuery, [refnr]);
            
            if (jobResult.rows.length === 0) {
                return res.json({ success: false, error: 'Job nicht gefunden' });
            }
            
            res.json({ success: true, data: jobResult.rows[0] });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('API job-detail error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Puppeteer service is only imported and used when admin features are actually needed

// Admin API endpoints for Puppeteer navigation
app.get('/admin/api/puppeteer-status', async (req, res) => {
    try {
        const { getPuppeteerService } = require('./persistent-puppeteer-service');
        const puppeteerService = getPuppeteerService();
        const status = puppeteerService.getQueueStatus();
        const health = await puppeteerService.healthCheck();
        
        res.json({
            success: true,
            status,
            health
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/admin/api/puppeteer-navigate', async (req, res) => {
    try {
        const { refnr, includeEmailExtraction = false } = req.body;
        
        if (!refnr) {
            return res.status(400).json({
                success: false,
                error: 'refnr is required'
            });
        }

        const { getPuppeteerService } = require('./persistent-puppeteer-service');
        const puppeteerService = getPuppeteerService();
        const result = await puppeteerService.navigateToJob(refnr, includeEmailExtraction);
        
        res.json(result);
    } catch (error) {
        console.error('Admin Puppeteer navigation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin navigation endpoint (wrapper for the API endpoint)
app.post('/admin/navigate-to-job', async (req, res) => {
    try {
        const { refnr, includeEmailExtraction = true } = req.body;
        
        if (!refnr) {
            return res.status(400).json({
                success: false,
                error: 'Referenznummer erforderlich'
            });
        }

        const { getPuppeteerService } = require('./persistent-puppeteer-service');
        const puppeteerService = getPuppeteerService();
        
        // Initialize service if not already done
        if (!puppeteerService.isInitialized) {
            console.log('🚀 Initializing Puppeteer service for admin navigation...');
            const initialized = await puppeteerService.initialize();
            if (!initialized) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to initialize Puppeteer service'
                });
            }
        }
        
        // Navigate to job with CAPTCHA solving
        const result = await puppeteerService.navigateToJob(refnr, includeEmailExtraction);
        
        // If email extraction was successful, update the database
        if (result.success && result.emails && result.emails.length > 0) {
            try {
                const client = await pool.connect();
                try {
                    const insertQuery = `
                        INSERT INTO job_scrp_job_details (
                            reference_number,
                            contact_emails,
                            best_email,
                            company_domain,
                            has_emails,
                            email_count,
                            scraped_at,
                            scraping_duration_ms,
                            captcha_solved,
                            scraping_success,
                            source_url
                        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10)
                        ON CONFLICT (reference_number) DO UPDATE SET
                            contact_emails = EXCLUDED.contact_emails,
                            best_email = EXCLUDED.best_email,
                            company_domain = EXCLUDED.company_domain,
                            has_emails = EXCLUDED.has_emails,
                            email_count = EXCLUDED.email_count,
                            scraped_at = CURRENT_TIMESTAMP,
                            scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                            captcha_solved = EXCLUDED.captcha_solved,
                            scraping_success = EXCLUDED.scraping_success,
                            source_url = EXCLUDED.source_url
                    `;
                    
                    const emailsString = result.emails.join(', ');
                    const bestEmail = result.emails[0] || null;
                    const domain = result.emailResult?.domain || (bestEmail ? bestEmail.split('@')[1] : null);
                    
                    await client.query(insertQuery, [
                        refnr,
                        emailsString,
                        bestEmail,
                        domain,
                        result.emails.length > 0,
                        result.emails.length,
                        result.loadTime,
                        result.captchaSolved,
                        result.success,
                        result.url
                    ]);
                    
                    console.log(`💾 Saved ${result.emails.length} emails for job ${refnr} to database`);
                } finally {
                    client.release();
                }
            } catch (dbError) {
                console.error('Database save error:', dbError.message);
                // Don't fail the request due to DB error, but log it
            }
        }
        
        res.json(result);
    } catch (error) {
        console.error('Admin navigation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/admin/api/puppeteer-initialize', async (req, res) => {
    try {
        const { getPuppeteerService } = require('./persistent-puppeteer-service');
        const puppeteerService = getPuppeteerService();
        const initialized = await puppeteerService.initialize();
        
        res.json({
            success: initialized,
            message: initialized ? 'Puppeteer service initialized' : 'Failed to initialize Puppeteer service'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin job palette view (with Puppeteer integration)
app.get('/admin/job-palette/:refnr', async (req, res) => {
    try {
        const { refnr } = req.params;
        const client = await pool.connect();
        try {
            // Get current job details
            const jobQuery = `
                SELECT 
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    j.aktuelleveroeffentlichungsdatum,
                    j.eintrittsdatum,
                    jd.best_email,
                    jd.company_domain,
                    jd.email_source,
                    jd.scraping_success,
                    jd.scraped_at
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.refnr = $1 AND j.is_active = true
            `;
            const jobResult = await client.query(jobQuery, [refnr]);
            
            if (jobResult.rows.length === 0) {
                return res.status(404).send('<h1>Job nicht gefunden</h1>');
            }
            
            const job = jobResult.rows[0];
            const arbeitsagenturUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
            
            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
                    <meta http-equiv="Pragma" content="no-cache">
                    <meta http-equiv="Expires" content="0">
                    <title>🤖 Admin Job Palette - ${job.titel}</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
                    <style>
                        body {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                        }
                        .admin-palette-card {
                            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
                            border: none;
                            background: rgba(255, 255, 255, 0.95);
                            backdrop-filter: blur(10px);
                        }
                        .admin-header {
                            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
                            color: white;
                        }
                        .btn-group .btn {
                            border-color: rgba(255, 255, 255, 0.3);
                        }
                        .position-display {
                            background: rgba(255, 255, 255, 0.2);
                            color: white;
                            font-weight: bold;
                            min-width: 80px;
                        }
                        .puppeteer-status {
                            font-size: 0.8rem;
                            padding: 0.25rem 0.5rem;
                        }
                        .admin-badge {
                            animation: pulse 2s infinite;
                        }
                        @keyframes pulse {
                            0% { opacity: 1; }
                            50% { opacity: 0.5; }
                            100% { opacity: 1; }
                        }
                    </style>
                </head>
                <body>
                    <!-- Admin Navigation Palette -->
                    <div class="container-fluid p-3">
                        <div class="row">
                            <div class="col-12">
                                <div class="card admin-palette-card">
                                    <div class="card-header admin-header">
                                        <div class="row align-items-center">
                                            <div class="col-md-2">
                                                <h6 class="mb-0">
                                                    <span class="badge bg-warning admin-badge me-2">🤖 ADMIN</span>
                                                    Job Navigation
                                                </h6>
                                            </div>
                                            <div class="col-md-6 text-center">
                                                <div class="btn-group" role="group">
                                                    <button class="btn btn-light btn-sm" onclick="firstJob()" id="firstBtn" title="Zum ersten Job">
                                                        <i class="bi bi-skip-start"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="previousJob()" id="prevBtn" title="Vorheriger Job">
                                                        <i class="bi bi-chevron-left"></i>
                                                    </button>
                                                    <span class="btn btn-outline-light btn-sm position-display" id="positionDisplay">
                                                        1 / 1
                                                    </span>
                                                    <button class="btn btn-light btn-sm" onclick="nextJob()" id="nextBtn" title="Nächster Job">
                                                        <i class="bi bi-chevron-right"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="lastJob()" id="lastBtn" title="Zum letzten Job">
                                                        <i class="bi bi-skip-end"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="col-md-4 text-end">
                                                <div id="puppeteerStatus" class="badge bg-secondary puppeteer-status me-2">
                                                    🔄 Initialisiere...
                                                </div>
                                                <button class="btn btn-light btn-sm" onclick="refreshPuppeteerView()" title="Puppeteer-Ansicht aktualisieren">
                                                    <i class="bi bi-arrow-clockwise"></i> Puppeteer
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        <!-- Job Information Display -->
                                        <div class="row">
                                            <div class="col-md-8">
                                                <h5 class="mb-2" id="jobTitle">${job.titel}</h5>
                                                <h6 class="text-primary mb-2" id="jobCompany">${job.arbeitgeber}</h6>
                                                <p class="mb-2">
                                                    <i class="bi bi-geo-alt text-muted"></i>
                                                    <span id="jobLocation">${job.arbeitsort_ort} (${job.arbeitsort_plz})</span>
                                                    <span class="ms-3">
                                                        <i class="bi bi-briefcase text-muted"></i>
                                                        <span id="jobBeruf">${job.beruf || 'Nicht angegeben'}</span>
                                                    </span>
                                                </p>
                                                <p class="text-muted mb-3">
                                                    <small>
                                                        <strong>Referenz:</strong> <span id="jobRefnr">${job.refnr}</span> • 
                                                        <strong>Veröffentlicht:</strong> <span id="jobPublished">${job.aktuelleveroeffentlichungsdatum ? new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt'}</span>
                                                        ${job.eintrittsdatum ? ' • <strong>Eintrittsdatum:</strong> <span id="jobStart">' + new Date(job.eintrittsdatum).toLocaleDateString('de-DE') + '</span>' : ''}
                                                    </small>
                                                </p>
                                            </div>
                                            <div class="col-md-4">
                                                <div class="text-end">
                                                    <div id="emailInfo" class="mb-2">
                                                        ${job.best_email ? `
                                                            <div class="alert alert-success py-2 mb-2">
                                                                <i class="bi bi-envelope text-success"></i>
                                                                <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                                                ${job.email_source ? `<br><small class="text-muted">Quelle: ${job.email_source}</small>` : ''}
                                                            </div>
                                                        ` : `
                                                            <div class="alert alert-light py-2 mb-2">
                                                                <i class="bi bi-envelope-x text-muted"></i>
                                                                <span class="ms-1 text-muted">Keine Email gefunden</span>
                                                            </div>
                                                        `}
                                                    </div>
                                                    <div class="btn-group-vertical w-100" role="group">
                                                        <a id="direktLink" href="${arbeitsagenturUrl}" target="_blank" class="btn btn-primary btn-sm">
                                                            <i class="bi bi-box-arrow-up-right"></i> Stellenanzeige öffnen
                                                        </a>
                                                        <button class="btn btn-outline-info btn-sm" onclick="loadWithPuppeteerExtraction()" title="Mit Email-Extraktion laden">
                                                            <i class="bi bi-robot"></i> Auto Email-Extraktion
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        let currentRefnr = '${job.refnr}';
                        let navigationHistory = [];
                        let puppeteerInitialized = false;
                        
                        // Load navigation history from the last search results
                        function loadNavigationHistory() {
                            const lastSearchResults = JSON.parse(sessionStorage.getItem('lastSearchResults') || '[]');
                            if (lastSearchResults.length > 0) {
                                navigationHistory = lastSearchResults.map(result => result.refnr);
                            } else {
                                navigationHistory = [currentRefnr];
                            }
                            
                            if (!navigationHistory.includes(currentRefnr)) {
                                navigationHistory.push(currentRefnr);
                            }
                            
                            sessionStorage.setItem('jobNavigation', JSON.stringify(navigationHistory));
                        }
                        
                        // Initialize navigation history
                        loadNavigationHistory();
                        
                        // Initialize Puppeteer service
                        async function initializePuppeteer() {
                            try {
                                updatePuppeteerStatus('🔄 Initialisiere Puppeteer...', 'secondary');
                                
                                const response = await fetch('/admin/api/puppeteer-initialize', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' }
                                });
                                
                                const result = await response.json();
                                
                                if (result.success) {
                                    puppeteerInitialized = true;
                                    updatePuppeteerStatus('✅ Puppeteer bereit', 'success');
                                    // Automatically load current job
                                    loadJobWithPuppeteer(currentRefnr);
                                } else {
                                    updatePuppeteerStatus('❌ Puppeteer Fehler', 'danger');
                                }
                            } catch (error) {
                                console.error('Puppeteer initialization error:', error);
                                updatePuppeteerStatus('❌ Verbindungsfehler', 'danger');
                            }
                        }
                        
                        function updatePuppeteerStatus(text, type) {
                            const statusElement = document.getElementById('puppeteerStatus');
                            statusElement.textContent = text;
                            statusElement.className = \`badge bg-${type} puppeteer-status me-2\`;
                        }
                        
                        async function loadJobWithPuppeteer(refnr, includeEmailExtraction = false) {
                            try {
                                updatePuppeteerStatus('🔄 Lade Job...', 'warning');
                                
                                const response = await fetch('/admin/api/puppeteer-navigate', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ 
                                        refnr,
                                        includeEmailExtraction 
                                    })
                                });
                                
                                const result = await response.json();
                                
                                if (result.success) {
                                    updatePuppeteerStatus(\`✅ Geladen ${result.captchaSolved ? '(CAPTCHA gelöst)' : ''}\`, 'success');
                                    
                                    // Open the job detail in separate window
                                    openJobDetailWindow(refnr);
                                    
                                    if (includeEmailExtraction && result.emails && result.emails.length > 0) {
                                        showEmailExtractionResult(result);
                                    }
                                } else {
                                    updatePuppeteerStatus('❌ Fehler beim Laden', 'danger');
                                    console.error('Puppeteer navigation error:', result.error);
                                }
                            } catch (error) {
                                updatePuppeteerStatus('❌ Verbindungsfehler', 'danger');
                                console.error('Load job error:', error);
                            }
                        }
                        
                        function showEmailExtractionResult(result) {
                            // Update email info with extracted emails
                            const emailInfo = document.getElementById('emailInfo');
                            if (result.emails && result.emails.length > 0) {
                                emailInfo.innerHTML = 
                                    '<div class="alert alert-success py-2 mb-2">' +
                                        '<strong>🤖 Auto-extrahiert (' + result.emails.length + '):</strong><br>' +
                                        result.emails.map(email => '<a href="mailto:' + email + '" class="d-block">' + email + '</a>').join('') +
                                        '<small class="text-muted">CAPTCHA: ' + (result.captchaSolved ? 'Gelöst' : 'Nicht nötig') + '</small>' +
                                    '</div>';
                            }
                        }
                        
                        function firstJob() {
                            if (navigationHistory.length > 0) {
                                const firstRefnr = navigationHistory[0];
                                loadJobInPalette(firstRefnr);
                            }
                        }
                        
                        function previousJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex > 0) {
                                const prevRefnr = navigationHistory[currentIndex - 1];
                                loadJobInPalette(prevRefnr);
                            }
                        }
                        
                        function nextJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex < navigationHistory.length - 1) {
                                const nextRefnr = navigationHistory[currentIndex + 1];
                                loadJobInPalette(nextRefnr);
                            }
                        }
                        
                        function lastJob() {
                            if (navigationHistory.length > 0) {
                                const lastRefnr = navigationHistory[navigationHistory.length - 1];
                                loadJobInPalette(lastRefnr);
                            }
                        }
                        
                        function loadJobInPalette(refnr) {
                            document.getElementById('jobTitle').innerHTML = '<i class="spinner-border spinner-border-sm"></i> Lade...';
                            
                            fetch('/api/job-detail/' + refnr)
                                .then(response => response.json())
                                .then(job => {
                                    if (job.success) {
                                        updatePaletteDisplay(job.data);
                                        currentRefnr = refnr;
                                        updateNavigationButtons();
                                        updatePositionDisplay();
                                        
                                        // Load with Puppeteer automatically
                                        loadJobWithPuppeteer(refnr);
                                    } else {
                                        alert('Job nicht gefunden: ' + refnr);
                                    }
                                })
                                .catch(error => {
                                    console.error('Error loading job:', error);
                                    alert('Fehler beim Laden des Jobs');
                                });
                        }
                        
                        function updatePaletteDisplay(job) {
                            document.getElementById('jobTitle').textContent = job.titel;
                            document.getElementById('jobCompany').textContent = job.arbeitgeber;
                            document.getElementById('jobLocation').textContent = (job.arbeitsort_ort || '') + (job.arbeitsort_plz ? ' (' + job.arbeitsort_plz + ')' : '');
                            document.getElementById('jobBeruf').textContent = job.beruf || 'Nicht angegeben';
                            document.getElementById('jobRefnr').textContent = job.refnr;
                            
                            const publishedDate = job.aktuelleveroeffentlichungsdatum ? 
                                new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt';
                            document.getElementById('jobPublished').textContent = publishedDate;
                            
                            if (job.eintrittsdatum && document.getElementById('jobStart')) {
                                document.getElementById('jobStart').textContent = new Date(job.eintrittsdatum).toLocaleDateString('de-DE');
                            }
                            
                            // Reset email info to database state initially
                            const emailInfo = document.getElementById('emailInfo');
                            if (job.best_email) {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-success py-2 mb-2">
                                        <i class="bi bi-envelope text-success"></i>
                                        <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                        ${job.email_source ? '<br><small class="text-muted">Quelle: ' + job.email_source + '</small>' : ''}
                                    </div>
                                \`;
                            } else {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-light py-2 mb-2">
                                        <i class="bi bi-envelope-x text-muted"></i>
                                        <span class="ms-1 text-muted">Keine Email gefunden</span>
                                    </div>
                                \`;
                            }
                            
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + job.refnr;
                            document.getElementById('direktLink').href = arbeitsagenturUrl;
                        }
                        
                        function updatePositionDisplay() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const position = currentIndex + 1;
                            const total = navigationHistory.length;
                            document.getElementById('positionDisplay').textContent = position + ' / ' + total;
                        }
                        
                        function openJobDetailWindow(refnr) {
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + refnr;
                            const width = 1400;
                            const height = 900;
                            
                            const currentWindowLeft = window.screenX || window.screenLeft || 0;
                            const currentWindowWidth = window.outerWidth || 800;
                            const left = currentWindowLeft + currentWindowWidth + 10;
                            const top = window.screenY || window.screenTop || 0;
                            
                            const jobWindow = window.open(
                                arbeitsagenturUrl,
                                'jobDetailWindow',
                                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',scrollbars=yes,resizable=yes,toolbar=no,menubar=no'
                            );
                            
                            if (jobWindow) {
                                jobWindow.focus();
                            }
                        }
                        
                        function refreshPuppeteerView() {
                            loadJobWithPuppeteer(currentRefnr, false);
                        }
                        
                        function loadWithPuppeteerExtraction() {
                            loadJobWithPuppeteer(currentRefnr, true);
                        }
                        
                        function updateNavigationButtons() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const firstBtn = document.getElementById('firstBtn');
                            const prevBtn = document.getElementById('prevBtn');
                            const nextBtn = document.getElementById('nextBtn');
                            const lastBtn = document.getElementById('lastBtn');
                            
                            firstBtn.disabled = currentIndex <= 0;
                            prevBtn.disabled = currentIndex <= 0;
                            nextBtn.disabled = currentIndex >= navigationHistory.length - 1;
                            lastBtn.disabled = currentIndex >= navigationHistory.length - 1;
                        }
                        
                        // Initialize everything
                        updateNavigationButtons();
                        updatePositionDisplay();
                        initializePuppeteer();
                    </script>
                </body>
                </html>
            `);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Admin job palette error:', error);
        res.status(500).send('<h1>Server Error</h1>');
    }
});

// Job palette view (separate window for navigation)
app.get('/job-palette/:refnr', async (req, res) => {
    try {
        const { refnr } = req.params;
        const client = await pool.connect();
        try {
            // Get current job details
            const jobQuery = `
                SELECT 
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    j.aktuelleveroeffentlichungsdatum,
                    j.eintrittsdatum,
                    jd.best_email,
                    jd.company_domain,
                    jd.email_source,
                    jd.scraping_success,
                    jd.scraped_at
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.refnr = $1 AND j.is_active = true
            `;
            const jobResult = await client.query(jobQuery, [refnr]);
            
            if (jobResult.rows.length === 0) {
                return res.status(404).send('<h1>Job nicht gefunden</h1>');
            }
            
            const job = jobResult.rows[0];
            const arbeitsagenturUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
            
            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
                    <meta http-equiv="Pragma" content="no-cache">
                    <meta http-equiv="Expires" content="0">
                    <title>Job Palette - ${job.titel}</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
                    <style>
                        body {
                            background: #f8f9fa;
                        }
                        .palette-card {
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            border: none;
                        }
                        .palette-header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .btn-group .btn {
                            border-color: rgba(255, 255, 255, 0.3);
                        }
                        .position-display {
                            background: rgba(255, 255, 255, 0.2);
                            color: white;
                            font-weight: bold;
                            min-width: 80px;
                        }
                    </style>
                </head>
                <body>
                    <!-- Navigation Palette -->
                    <div class="container-fluid p-3">
                        <div class="row">
                            <div class="col-12">
                                <div class="card palette-card">
                                    <div class="card-header palette-header text-white">
                                        <div class="row align-items-center">
                                            <div class="col-md-2">
                                                <h6 class="mb-0">
                                                    <i class="bi bi-list-ul"></i> Job Navigation
                                                </h6>
                                            </div>
                                            <div class="col-md-8 text-center">
                                                <div class="btn-group" role="group">
                                                    <button class="btn btn-light btn-sm" onclick="firstJob()" id="firstBtn" title="Zum ersten Job">
                                                        <i class="bi bi-skip-start"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="previousJob()" id="prevBtn" title="Vorheriger Job">
                                                        <i class="bi bi-chevron-left"></i>
                                                    </button>
                                                    <span class="btn btn-outline-light btn-sm position-display" id="positionDisplay">
                                                        1 / 1
                                                    </span>
                                                    <button class="btn btn-light btn-sm" onclick="nextJob()" id="nextBtn" title="Nächster Job">
                                                        <i class="bi bi-chevron-right"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="lastJob()" id="lastBtn" title="Zum letzten Job">
                                                        <i class="bi bi-skip-end"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="col-md-2 text-end">
                                                <button class="btn btn-light btn-sm" onclick="openCurrentJobInDetailWindow()" title="Detail-Fenster aktualisieren">
                                                    <i class="bi bi-arrow-clockwise"></i> Detail-Fenster
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        <!-- Job Information Display -->
                                        <div class="row">
                                            <div class="col-md-8">
                                                <h5 class="mb-2" id="jobTitle">${job.titel}</h5>
                                                <h6 class="text-primary mb-2" id="jobCompany">${job.arbeitgeber}</h6>
                                                <p class="mb-2">
                                                    <i class="bi bi-geo-alt text-muted"></i>
                                                    <span id="jobLocation">${job.arbeitsort_ort} (${job.arbeitsort_plz})</span>
                                                    <span class="ms-3">
                                                        <i class="bi bi-briefcase text-muted"></i>
                                                        <span id="jobBeruf">${job.beruf || 'Nicht angegeben'}</span>
                                                    </span>
                                                </p>
                                                <p class="text-muted mb-3">
                                                    <small>
                                                        <strong>Referenz:</strong> <span id="jobRefnr">${job.refnr}</span> • 
                                                        <strong>Veröffentlicht:</strong> <span id="jobPublished">${job.aktuelleveroeffentlichungsdatum ? new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt'}</span>
                                                        ${job.eintrittsdatum ? ' • <strong>Eintrittsdatum:</strong> <span id="jobStart">' + new Date(job.eintrittsdatum).toLocaleDateString('de-DE') + '</span>' : ''}
                                                    </small>
                                                </p>
                                            </div>
                                            <div class="col-md-4">
                                                <div class="text-end">
                                                    <div id="emailInfo" class="mb-2">
                                                        ${job.best_email ? `
                                                            <div class="alert alert-success py-2 mb-2">
                                                                <i class="bi bi-envelope text-success"></i>
                                                                <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                                                ${job.email_source ? `<br><small class="text-muted">Quelle: ${job.email_source}</small>` : ''}
                                                            </div>
                                                        ` : `
                                                            <div class="alert alert-light py-2 mb-2">
                                                                <i class="bi bi-envelope-x text-muted"></i>
                                                                <span class="ms-1 text-muted">Keine Email gefunden</span>
                                                            </div>
                                                        `}
                                                    </div>
                                                    <div class="btn-group-vertical w-100" role="group">
                                                        <a id="direktLink" href="${arbeitsagenturUrl}" target="_blank" class="btn btn-primary btn-sm">
                                                            <i class="bi bi-box-arrow-up-right"></i> Stellenanzeige öffnen
                                                        </a>
                                                        <button class="btn btn-outline-info btn-sm" onclick="loadWithPuppeteer()" title="Mit Puppeteer laden (Email-Extraktion)">
                                                            <i class="bi bi-robot"></i> Email-Extraktion
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        let currentRefnr = '${job.refnr}';
                        let navigationHistory = [];
                        
                        // Load navigation history from the last search results
                        function loadNavigationHistory() {
                            const lastSearchResults = JSON.parse(sessionStorage.getItem('lastSearchResults') || '[]');
                            if (lastSearchResults.length > 0) {
                                navigationHistory = lastSearchResults.map(result => result.refnr);
                            } else {
                                // Fallback: use the current job if no search history
                                navigationHistory = [currentRefnr];
                            }
                            
                            // Ensure current job is in the navigation history
                            if (!navigationHistory.includes(currentRefnr)) {
                                navigationHistory.push(currentRefnr);
                            }
                            
                            sessionStorage.setItem('jobNavigation', JSON.stringify(navigationHistory));
                        }
                        
                        // Initialize navigation history
                        loadNavigationHistory();
                        
                        function firstJob() {
                            if (navigationHistory.length > 0) {
                                const firstRefnr = navigationHistory[0];
                                loadJobInPalette(firstRefnr);
                            }
                        }
                        
                        function previousJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex > 0) {
                                const prevRefnr = navigationHistory[currentIndex - 1];
                                loadJobInPalette(prevRefnr);
                            }
                        }
                        
                        function nextJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex < navigationHistory.length - 1) {
                                const nextRefnr = navigationHistory[currentIndex + 1];
                                loadJobInPalette(nextRefnr);
                            }
                        }
                        
                        function lastJob() {
                            if (navigationHistory.length > 0) {
                                const lastRefnr = navigationHistory[navigationHistory.length - 1];
                                loadJobInPalette(lastRefnr);
                            }
                        }
                        
                        function loadJobInPalette(refnr) {
                            // Show loading state
                            document.getElementById('jobTitle').innerHTML = '<i class="spinner-border spinner-border-sm"></i> Lade...';
                            
                            // Fetch job data
                            fetch('/api/job-detail/' + refnr)
                                .then(response => response.json())
                                .then(job => {
                                    if (job.success) {
                                        updatePaletteDisplay(job.data);
                                        currentRefnr = refnr;
                                        updateNavigationButtons();
                                        updatePositionDisplay();
                                        
                                        // Automatically open/update the detail window
                                        openJobDetailWindow(refnr);
                                    } else {
                                        alert('Job nicht gefunden: ' + refnr);
                                    }
                                })
                                .catch(error => {
                                    console.error('Error loading job:', error);
                                    alert('Fehler beim Laden des Jobs');
                                });
                        }
                        
                        function updatePaletteDisplay(job) {
                            // Update all display elements
                            document.getElementById('jobTitle').textContent = job.titel;
                            document.getElementById('jobCompany').textContent = job.arbeitgeber;
                            document.getElementById('jobLocation').textContent = (job.arbeitsort_ort || '') + (job.arbeitsort_plz ? ' (' + job.arbeitsort_plz + ')' : '');
                            document.getElementById('jobBeruf').textContent = job.beruf || 'Nicht angegeben';
                            document.getElementById('jobRefnr').textContent = job.refnr;
                            
                            const publishedDate = job.aktuelleveroeffentlichungsdatum ? 
                                new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt';
                            document.getElementById('jobPublished').textContent = publishedDate;
                            
                            if (job.eintrittsdatum && document.getElementById('jobStart')) {
                                document.getElementById('jobStart').textContent = new Date(job.eintrittsdatum).toLocaleDateString('de-DE');
                            }
                            
                            // Update email info
                            const emailInfo = document.getElementById('emailInfo');
                            if (job.best_email) {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-success py-2 mb-2">
                                        <i class="bi bi-envelope text-success"></i>
                                        <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                        ${job.email_source ? '<br><small class="text-muted">Quelle: ' + job.email_source + '</small>' : ''}
                                    </div>
                                \`;
                            } else {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-light py-2 mb-2">
                                        <i class="bi bi-envelope-x text-muted"></i>
                                        <span class="ms-1 text-muted">Keine Email gefunden</span>
                                    </div>
                                \`;
                            }
                            
                            // Update direct link
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + job.refnr;
                            document.getElementById('direktLink').href = arbeitsagenturUrl;
                        }
                        
                        function updatePositionDisplay() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const position = currentIndex + 1;
                            const total = navigationHistory.length;
                            document.getElementById('positionDisplay').textContent = position + ' / ' + total;
                        }
                        
                        function openCurrentJobInDetailWindow() {
                            openJobDetailWindow(currentRefnr);
                        }
                        
                        function openJobDetailWindow(refnr) {
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + refnr;
                            const width = 1400;
                            const height = 900;
                            
                            // Position the window next to the palette window
                            const currentWindowLeft = window.screenX || window.screenLeft || 0;
                            const currentWindowWidth = window.outerWidth || 800;
                            const left = currentWindowLeft + currentWindowWidth + 10; // 10px gap
                            const top = window.screenY || window.screenTop || 0;
                            
                            // Open in named detail window (will be reused/overwritten)
                            const jobWindow = window.open(
                                arbeitsagenturUrl,
                                'jobDetailWindow',
                                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',scrollbars=yes,resizable=yes,toolbar=no,menubar=no'
                            );
                            
                            if (jobWindow) {
                                jobWindow.focus();
                            }
                        }
                        
                        // Update navigation button states
                        function updateNavigationButtons() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const firstBtn = document.getElementById('firstBtn');
                            const prevBtn = document.getElementById('prevBtn');
                            const nextBtn = document.getElementById('nextBtn');
                            const lastBtn = document.getElementById('lastBtn');
                            
                            // Disable buttons if no navigation possible
                            firstBtn.disabled = currentIndex <= 0;
                            prevBtn.disabled = currentIndex <= 0;
                            nextBtn.disabled = currentIndex >= navigationHistory.length - 1;
                            lastBtn.disabled = currentIndex >= navigationHistory.length - 1;
                        }
                        
                        function loadWithPuppeteer() {
                            // Puppeteer implementation would go here
                            alert('Puppeteer Email-Extraktion - würde hier implementiert werden');
                        }
                        
                        // Initialize display
                        updateNavigationButtons();
                        updatePositionDisplay();
                        
                        // Automatically open the detail window for the current job
                        setTimeout(() => {
                            openJobDetailWindow(currentRefnr);
                        }, 500); // Small delay to ensure page is fully loaded
                    </script>
                </body>
                </html>
            `);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Job palette error:', error);
        res.status(500).send('<h1>Server Error</h1>');
    }
});

// Job detail view with navigation (original - kept for compatibility)
app.get('/job-detail/:refnr', async (req, res) => {
    try {
        const { refnr } = req.params;
        const client = await pool.connect();
        try {
            // Get current job details
            const jobQuery = `
                SELECT 
                    j.refnr,
                    j.titel,
                    j.beruf,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    j.externeurl,
                    j.aktuelleveroeffentlichungsdatum,
                    j.eintrittsdatum,
                    jd.best_email,
                    jd.company_domain,
                    jd.email_source,
                    jd.scraping_success,
                    jd.scraped_at
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                WHERE j.refnr = $1 AND j.is_active = true
            `;
            const jobResult = await client.query(jobQuery, [refnr]);
            
            if (jobResult.rows.length === 0) {
                return res.status(404).send('<h1>Job nicht gefunden</h1>');
            }
            
            const job = jobResult.rows[0];
            const arbeitsagenturUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
            
            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
                    <meta http-equiv="Pragma" content="no-cache">
                    <meta http-equiv="Expires" content="0">
                    <title>Job Details - ${job.titel}</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
                    <style>
                        .navigation-controls {
                            background: #f8f9fa;
                            padding: 1rem;
                            border-bottom: 1px solid #dee2e6;
                        }
                        .job-info {
                            background: #fff;
                            border-bottom: 1px solid #dee2e6;
                            padding: 1rem;
                        }
                        .palette-card {
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            border: none;
                        }
                        .palette-header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .btn-group .btn {
                            border-color: rgba(255, 255, 255, 0.3);
                        }
                        .position-display {
                            background: rgba(255, 255, 255, 0.2);
                            color: white;
                            font-weight: bold;
                            min-width: 80px;
                        }
                    </style>
                </head>
                <body>
                    <!-- Navigation Header -->
                    <div class="navigation-controls">
                        <div class="container-fluid">
                            <div class="row align-items-center">
                                <div class="col-md-4">
                                    <a href="/email-search" class="btn btn-outline-secondary btn-sm">
                                        <i class="bi bi-arrow-left"></i> Zurück zur Suche
                                    </a>
                                    <button class="btn btn-outline-primary btn-sm ms-2" onclick="refreshFrame()">
                                        <i class="bi bi-arrow-clockwise"></i> Neu laden
                                    </button>
                                </div>
                                <div class="col-md-4 text-center">
                                    <button class="btn btn-outline-success btn-sm me-2" onclick="previousJob()" id="prevBtn">
                                        <i class="bi bi-chevron-left"></i> Vorheriger Job
                                    </button>
                                    <button class="btn btn-outline-success btn-sm" onclick="nextJob()" id="nextBtn">
                                        Nächster Job <i class="bi bi-chevron-right"></i>
                                    </button>
                                </div>
                                <div class="col-md-4 text-end">
                                    <button class="btn btn-outline-info btn-sm me-1" onclick="loadWithPuppeteer()" title="Seite über Puppeteer laden (wie beim Scraping)">
                                        <i class="bi bi-robot"></i> Puppeteer
                                    </button>
                                    <button class="btn btn-outline-primary btn-sm me-1" onclick="openInPopup()">
                                        <i class="bi bi-window"></i> Popup
                                    </button>
                                    <a href="${arbeitsagenturUrl}" target="_blank" class="btn btn-primary btn-sm">
                                        <i class="bi bi-box-arrow-up-right"></i> Neuer Tab
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Job Information -->
                    <div class="job-info">
                        <div class="container-fluid">
                            <div class="row">
                                <div class="col-md-8">
                                    <h5 class="mb-1">${job.titel}</h5>
                                    <p class="mb-1">
                                        <strong>${job.arbeitgeber}</strong> • 
                                        <span class="text-muted">${job.arbeitsort_ort} (${job.arbeitsort_plz})</span> • 
                                        <span class="text-muted">${job.beruf}</span>
                                    </p>
                                    <small class="text-muted">
                                        Ref: ${job.refnr} • 
                                        Veröffentlicht: ${job.aktuelleveroeffentlichungsdatum ? new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt'}
                                        ${job.eintrittsdatum ? ' • Eintrittsdatum: ' + new Date(job.eintrittsdatum).toLocaleDateString('de-DE') : ''}
                                    </small>
                                </div>
                                <div class="col-md-4 text-end">
                                    ${job.best_email ? `
                                        <div class="mb-2">
                                            <i class="bi bi-envelope text-success"></i>
                                            <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                            ${job.email_source ? `<br><small class="text-muted">Quelle: ${job.email_source}</small>` : ''}
                                        </div>
                                    ` : ''}
                                    ${job.company_domain ? `
                                        <div class="mb-2">
                                            <i class="bi bi-globe text-info"></i>
                                            <span class="ms-1">${job.company_domain}</span>
                                        </div>
                                    ` : ''}
                                    ${job.externeurl ? `
                                        <div class="mb-2">
                                            <i class="bi bi-link-45deg text-warning"></i>
                                            <span class="ms-1 text-muted">Externe URL</span>
                                        </div>
                                    ` : ''}
                                    ${job.scraping_success !== null ? `
                                        <div>
                                            <span class="badge ${job.scraping_success ? 'bg-success' : 'bg-danger'}">
                                                ${job.scraping_success ? 'Gescannt' : 'Scan fehlgeschlagen'}
                                            </span>
                                            ${job.scraped_at ? `<br><small class="text-muted">${new Date(job.scraped_at).toLocaleDateString('de-DE')}</small>` : ''}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Navigation Palette -->
                    <div class="container-fluid mt-4">
                        <div class="row">
                            <div class="col-12">
                                <div class="card palette-card">
                                    <div class="card-header palette-header text-white">
                                        <div class="row align-items-center">
                                            <div class="col-md-2">
                                                <h6 class="mb-0">
                                                    <i class="bi bi-list-ul"></i> Job Navigation
                                                </h6>
                                            </div>
                                            <div class="col-md-8 text-center">
                                                <div class="btn-group" role="group">
                                                    <button class="btn btn-light btn-sm" onclick="firstJob()" id="firstBtn" title="Zum ersten Job">
                                                        <i class="bi bi-skip-start"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="previousJob()" id="prevBtn" title="Vorheriger Job">
                                                        <i class="bi bi-chevron-left"></i>
                                                    </button>
                                                    <span class="btn btn-outline-light btn-sm position-display" id="positionDisplay">
                                                        1 / 1
                                                    </span>
                                                    <button class="btn btn-light btn-sm" onclick="nextJob()" id="nextBtn" title="Nächster Job">
                                                        <i class="bi bi-chevron-right"></i>
                                                    </button>
                                                    <button class="btn btn-light btn-sm" onclick="lastJob()" id="lastBtn" title="Zum letzten Job">
                                                        <i class="bi bi-skip-end"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="col-md-2 text-end">
                                                <button class="btn btn-light btn-sm" onclick="openCurrentJobInDetailWindow()" title="Detail-Fenster aktualisieren">
                                                    <i class="bi bi-arrow-clockwise"></i> Detail-Fenster
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        <!-- Job Information Display -->
                                        <div class="row">
                                            <div class="col-md-8">
                                                <h5 class="mb-2" id="jobTitle">${job.titel}</h5>
                                                <h6 class="text-primary mb-2" id="jobCompany">${job.arbeitgeber}</h6>
                                                <p class="mb-2">
                                                    <i class="bi bi-geo-alt text-muted"></i>
                                                    <span id="jobLocation">${job.arbeitsort_ort} (${job.arbeitsort_plz})</span>
                                                    <span class="ms-3">
                                                        <i class="bi bi-briefcase text-muted"></i>
                                                        <span id="jobBeruf">${job.beruf || 'Nicht angegeben'}</span>
                                                    </span>
                                                </p>
                                                <p class="text-muted mb-3">
                                                    <small>
                                                        <strong>Referenz:</strong> <span id="jobRefnr">${job.refnr}</span> • 
                                                        <strong>Veröffentlicht:</strong> <span id="jobPublished">${job.aktuelleveroeffentlichungsdatum ? new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt'}</span>
                                                        ${job.eintrittsdatum ? ' • <strong>Eintrittsdatum:</strong> <span id="jobStart">' + new Date(job.eintrittsdatum).toLocaleDateString('de-DE') + '</span>' : ''}
                                                    </small>
                                                </p>
                                            </div>
                                            <div class="col-md-4">
                                                <div class="text-end">
                                                    <div id="emailInfo" class="mb-2">
                                                        ${job.best_email ? `
                                                            <div class="alert alert-success py-2 mb-2">
                                                                <i class="bi bi-envelope text-success"></i>
                                                                <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                                                ${job.email_source ? `<br><small class="text-muted">Quelle: ${job.email_source}</small>` : ''}
                                                            </div>
                                                        ` : `
                                                            <div class="alert alert-light py-2 mb-2">
                                                                <i class="bi bi-envelope-x text-muted"></i>
                                                                <span class="ms-1 text-muted">Keine Email gefunden</span>
                                                            </div>
                                                        `}
                                                    </div>
                                                    <div class="btn-group-vertical w-100" role="group">
                                                        <a id="direktLink" href="${arbeitsagenturUrl}" target="_blank" class="btn btn-primary btn-sm">
                                                            <i class="bi bi-box-arrow-up-right"></i> Stellenanzeige öffnen
                                                        </a>
                                                        <button class="btn btn-outline-info btn-sm" onclick="loadWithPuppeteer()" title="Mit Puppeteer laden (Email-Extraktion)">
                                                            <i class="bi bi-robot"></i> Email-Extraktion
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        let currentRefnr = '${job.refnr}';
                        let navigationHistory = [];
                        
                        // Load navigation history from the last search results
                        function loadNavigationHistory() {
                            const lastSearchResults = JSON.parse(sessionStorage.getItem('lastSearchResults') || '[]');
                            if (lastSearchResults.length > 0) {
                                navigationHistory = lastSearchResults.map(result => result.refnr);
                            } else {
                                // Fallback: use the current job if no search history
                                navigationHistory = [currentRefnr];
                            }
                            
                            // Ensure current job is in the navigation history
                            if (!navigationHistory.includes(currentRefnr)) {
                                navigationHistory.push(currentRefnr);
                            }
                            
                            sessionStorage.setItem('jobNavigation', JSON.stringify(navigationHistory));
                        }
                        
                        // Initialize navigation history
                        loadNavigationHistory();
                        
                        function refreshFrame() {
                            document.getElementById('jobFrame').src = document.getElementById('jobFrame').src;
                        }
                        
                        function firstJob() {
                            if (navigationHistory.length > 0) {
                                const firstRefnr = navigationHistory[0];
                                loadJobInPalette(firstRefnr);
                            }
                        }
                        
                        function previousJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex > 0) {
                                const prevRefnr = navigationHistory[currentIndex - 1];
                                loadJobInPalette(prevRefnr);
                            }
                        }
                        
                        function nextJob() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            if (currentIndex < navigationHistory.length - 1) {
                                const nextRefnr = navigationHistory[currentIndex + 1];
                                loadJobInPalette(nextRefnr);
                            }
                        }
                        
                        function lastJob() {
                            if (navigationHistory.length > 0) {
                                const lastRefnr = navigationHistory[navigationHistory.length - 1];
                                loadJobInPalette(lastRefnr);
                            }
                        }
                        
                        function loadJobInPalette(refnr) {
                            // Show loading state
                            document.getElementById('jobTitle').innerHTML = '<i class="spinner-border spinner-border-sm"></i> Lade...';
                            
                            // Fetch job data
                            fetch('/api/job-detail/' + refnr)
                                .then(response => response.json())
                                .then(job => {
                                    if (job.success) {
                                        updatePaletteDisplay(job.data);
                                        currentRefnr = refnr;
                                        updateNavigationButtons();
                                        updatePositionDisplay();
                                        
                                        // Automatically open/update the detail window
                                        openJobDetailWindow(refnr);
                                    } else {
                                        alert('Job nicht gefunden: ' + refnr);
                                    }
                                })
                                .catch(error => {
                                    console.error('Error loading job:', error);
                                    alert('Fehler beim Laden des Jobs');
                                });
                        }
                        
                        function updatePaletteDisplay(job) {
                            // Update all display elements
                            document.getElementById('jobTitle').textContent = job.titel;
                            document.getElementById('jobCompany').textContent = job.arbeitgeber;
                            document.getElementById('jobLocation').textContent = (job.arbeitsort_ort || '') + (job.arbeitsort_plz ? ' (' + job.arbeitsort_plz + ')' : '');
                            document.getElementById('jobBeruf').textContent = job.beruf || 'Nicht angegeben';
                            document.getElementById('jobRefnr').textContent = job.refnr;
                            
                            const publishedDate = job.aktuelleveroeffentlichungsdatum ? 
                                new Date(job.aktuelleveroeffentlichungsdatum).toLocaleDateString('de-DE') : 'Unbekannt';
                            document.getElementById('jobPublished').textContent = publishedDate;
                            
                            if (job.eintrittsdatum && document.getElementById('jobStart')) {
                                document.getElementById('jobStart').textContent = new Date(job.eintrittsdatum).toLocaleDateString('de-DE');
                            }
                            
                            // Update email info
                            const emailInfo = document.getElementById('emailInfo');
                            if (job.best_email) {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-success py-2 mb-2">
                                        <i class="bi bi-envelope text-success"></i>
                                        <a href="mailto:${job.best_email}" class="text-decoration-none ms-1">${job.best_email}</a>
                                        ${job.email_source ? '<br><small class="text-muted">Quelle: ' + job.email_source + '</small>' : ''}
                                    </div>
                                \`;
                            } else {
                                emailInfo.innerHTML = \`
                                    <div class="alert alert-light py-2 mb-2">
                                        <i class="bi bi-envelope-x text-muted"></i>
                                        <span class="ms-1 text-muted">Keine Email gefunden</span>
                                    </div>
                                \`;
                            }
                            
                            // Update direct link
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + job.refnr;
                            document.getElementById('direktLink').href = arbeitsagenturUrl;
                        }
                        
                        function updatePositionDisplay() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const position = currentIndex + 1;
                            const total = navigationHistory.length;
                            document.getElementById('positionDisplay').textContent = position + ' / ' + total;
                        }
                        
                        function openCurrentJobInDetailWindow() {
                            openJobDetailWindow(currentRefnr);
                        }
                        
                        function openJobDetailWindow(refnr) {
                            const arbeitsagenturUrl = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + refnr;
                            const width = 1400;
                            const height = 900;
                            
                            // Position the window next to the current window
                            const currentWindowLeft = window.screenX || window.screenLeft || 0;
                            const currentWindowWidth = window.outerWidth || 1200;
                            const left = currentWindowLeft + currentWindowWidth + 10; // 10px gap
                            const top = window.screenY || window.screenTop || 0;
                            
                            // Open in named detail window (will be reused/overwritten)
                            const jobWindow = window.open(
                                arbeitsagenturUrl,
                                'jobDetailWindow',
                                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',scrollbars=yes,resizable=yes,toolbar=no,menubar=no'
                            );
                            
                            if (jobWindow) {
                                jobWindow.focus();
                            }
                        }
                        
                        function openJobInSeparateWindow(refnr) {
                            const width = 1400;
                            const height = 900;
                            const left = (screen.width - width) / 2;
                            const top = (screen.height - height) / 2;
                            
                            // Use a consistent window name so it gets overwritten
                            const jobWindow = window.open(
                                '/job-detail/' + refnr,
                                'jobDetailWindow',
                                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',scrollbars=yes,resizable=yes,toolbar=no,menubar=no'
                            );
                            
                            if (jobWindow) {
                                jobWindow.focus();
                            }
                        }
                        
                        // Update navigation button states
                        function updateNavigationButtons() {
                            const currentIndex = navigationHistory.indexOf(currentRefnr);
                            const firstBtn = document.getElementById('firstBtn');
                            const prevBtn = document.getElementById('prevBtn');
                            const nextBtn = document.getElementById('nextBtn');
                            const lastBtn = document.getElementById('lastBtn');
                            
                            // Disable buttons if no navigation possible
                            firstBtn.disabled = currentIndex <= 0;
                            prevBtn.disabled = currentIndex <= 0;
                            nextBtn.disabled = currentIndex >= navigationHistory.length - 1;
                            lastBtn.disabled = currentIndex >= navigationHistory.length - 1;
                        }
                        
                        // Initialize display
                        updateNavigationButtons();
                        updatePositionDisplay();
                        
                        // Automatically open the detail window for the current job
                        setTimeout(() => {
                            openJobDetailWindow(currentRefnr);
                        }, 500); // Small delay to ensure page is fully loaded
                        
                        // Handle iframe loading
                        function handleIframeLoad() {
                            const iframe = document.getElementById('jobFrame');
                            try {
                                // Try to access iframe content to check if it loaded successfully
                                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                                if (iframeDoc.body && iframeDoc.body.innerHTML.length > 0) {
                                    // Iframe loaded successfully
                                    console.log('Iframe loaded successfully');
                                } else {
                                    throw new Error('Empty content');
                                }
                            } catch (e) {
                                // Cross-origin or other loading issue
                                setTimeout(() => {
                                    showIframeFallback();
                                }, 3000); // Wait 3 seconds then show fallback
                            }
                        }
                        
                        function handleIframeError() {
                            showIframeFallback();
                        }
                        
                        function showIframeFallback() {
                            document.getElementById('jobFrame').style.display = 'none';
                            document.getElementById('iframeFallback').classList.remove('d-none');
                        }
                        
                        function showJobContent() {
                            document.getElementById('jobContentSection').classList.remove('d-none');
                        }
                        
                        function openInPopup() {
                            const width = 1200;
                            const height = 800;
                            const left = (screen.width - width) / 2;
                            const top = (screen.height - height) / 2;
                            
                            window.open(
                                '${arbeitsagenturUrl}', 
                                'jobDetails', 
                                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',scrollbars=yes,resizable=yes'
                            );
                        }
                        
                        function loadWithPuppeteer() {
                            // Show loading state
                            const iframe = document.getElementById('jobFrame');
                            const fallback = document.getElementById('iframeFallback');
                            
                            iframe.style.display = 'none';
                            fallback.classList.remove('d-none');
                            fallback.innerHTML = \`
                                <div class="text-center p-5">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                    <h5 class="mt-3">Lade Seite mit Puppeteer...</h5>
                                    <p class="text-muted">Dies entspricht genau dem Scraping-Prozess</p>
                                </div>
                            \`;
                            
                            // Load page via Puppeteer API
                            fetch('/api/puppeteer-page', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    refnr: currentRefnr,
                                    includeEmailExtraction: true 
                                })
                            })
                            .then(response => response.json())
                            .then(data => {
                                if (data.success) {
                                    displayPuppeteerResult(data);
                                } else {
                                    showPuppeteerError(data.error);
                                }
                            })
                            .catch(error => {
                                showPuppeteerError(error.message);
                            });
                        }
                        
                        function displayPuppeteerResult(data) {
                            const fallback = document.getElementById('iframeFallback');
                            fallback.innerHTML = \`
                                <div class="row">
                                    <div class="col-md-8">
                                        <div class="card">
                                            <div class="card-header d-flex justify-content-between align-items-center">
                                                <h6 class="mb-0">Puppeteer-Ansicht (wie beim Scraping)</h6>
                                                <button class="btn btn-sm btn-outline-secondary" onclick="toggleFullscreen('puppeteerImage')">
                                                    <i class="bi bi-arrows-fullscreen"></i> Vollbild
                                                </button>
                                            </div>
                                            <div class="card-body p-0">
                                                <img id="puppeteerImage" src="data:image/png;base64,${data.screenshot}" 
                                                     class="img-fluid w-100" style="cursor: zoom-in;" 
                                                     onclick="toggleFullscreen('puppeteerImage')" />
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="card">
                                            <div class="card-header">
                                                <h6 class="mb-0">Extrahierte Email-Adressen</h6>
                                            </div>
                                            <div class="card-body">
                                                \${data.emails && data.emails.length > 0 ? \`
                                                    <div class="alert alert-success">
                                                        <h6>Gefundene Emails (${data.emails.length}):</h6>
                                                        \${data.emails.map(email => \`
                                                            <div class="mb-2">
                                                                <i class="bi bi-envelope text-success"></i>
                                                                <a href="mailto:${email}" class="ms-1">${email}</a>
                                                            </div>
                                                        \`).join('')}
                                                    </div>
                                                \` : \`
                                                    <div class="alert alert-warning">
                                                        <i class="bi bi-exclamation-triangle"></i>
                                                        Keine Email-Adressen gefunden
                                                    </div>
                                                \`}
                                                
                                                \${data.captchaSolved ? \`
                                                    <div class="alert alert-info">
                                                        <i class="bi bi-shield-check"></i>
                                                        Captcha wurde gelöst
                                                    </div>
                                                \` : ''}
                                                
                                                <div class="mt-3">
                                                    <small class="text-muted">
                                                        <strong>Ladezeit:</strong> ${data.loadTime}ms<br>
                                                        <strong>Screenshot:</strong> ${new Date().toLocaleTimeString('de-DE')}
                                                    </small>
                                                </div>
                                                
                                                <div class="mt-3">
                                                    <button class="btn btn-sm btn-primary w-100" onclick="refreshPuppeteerView()">
                                                        <i class="bi bi-arrow-clockwise"></i> Neu laden
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            \`;
                        }
                        
                        function showPuppeteerError(error) {
                            const fallback = document.getElementById('iframeFallback');
                            fallback.innerHTML = \`
                                <div class="alert alert-danger">
                                    <h5><i class="bi bi-exclamation-triangle"></i> Puppeteer-Fehler</h5>
                                    <p>${error}</p>
                                    <button class="btn btn-outline-danger" onclick="loadWithPuppeteer()">
                                        <i class="bi bi-arrow-clockwise"></i> Erneut versuchen
                                    </button>
                                </div>
                            \`;
                        }
                        
                        function refreshPuppeteerView() {
                            loadWithPuppeteer();
                        }
                        
                        function toggleFullscreen(imageId) {
                            const img = document.getElementById(imageId);
                            if (img.requestFullscreen) {
                                img.requestFullscreen();
                            } else if (img.webkitRequestFullscreen) {
                                img.webkitRequestFullscreen();
                            } else if (img.msRequestFullscreen) {
                                img.msRequestFullscreen();
                            }
                        }
                        
                        // Auto-detect if iframe is blocked after 5 seconds
                        setTimeout(() => {
                            const iframe = document.getElementById('jobFrame');
                            if (iframe.style.display !== 'none') {
                                try {
                                    // If we can't access the iframe content, it's likely blocked
                                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                                    if (!iframeDoc || iframeDoc.location.href === 'about:blank') {
                                        showIframeFallback();
                                    }
                                } catch (e) {
                                    // Cross-origin restriction - this is expected and means the iframe might be working
                                    console.log('Iframe cross-origin restriction detected - this is normal');
                                }
                            }
                        }, 5000);
                        
                        // Handle keyboard navigation
                        document.addEventListener('keydown', function(e) {
                            if (e.ctrlKey || e.metaKey) {
                                if (e.key === 'ArrowLeft') {
                                    e.preventDefault();
                                    previousJob();
                                } else if (e.key === 'ArrowRight') {
                                    e.preventDefault();
                                    nextJob();
                                }
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
        console.error('Job detail error:', error);
        res.status(500).send('<h1>Fehler beim Laden der Job-Details</h1><p>' + error.message + '</p>');
    }
});

// Puppeteer page viewer API - for validation/debugging
app.post('/api/puppeteer-page', async (req, res) => {
    try {
        const { refnr, includeEmailExtraction } = req.body;
        
        if (!refnr) {
            return res.status(400).json({
                success: false,
                error: 'Referenznummer erforderlich'
            });
        }
        
        const puppeteer = require('puppeteer');
        const EmailExtractor = require('./email-extractor');
        const IndependentCaptchaSolver = require('./independent-captcha-solver');
        
        const startTime = Date.now();
        let browser = null;
        
        try {
            // Get job info from database
            const client = await pool.connect();
            let jobData = null;
            
            try {
                const jobQuery = `
                    SELECT refnr, titel, arbeitgeber, externeurl 
                    FROM job_scrp_arbeitsagentur_jobs_v2 
                    WHERE refnr = $1 AND is_active = true
                `;
                const jobResult = await client.query(jobQuery, [refnr]);
                
                if (jobResult.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'Job nicht gefunden'
                    });
                }
                
                jobData = jobResult.rows[0];
            } finally {
                client.release();
            }
            
            // Check if job has external URL
            if (jobData.externeurl && jobData.externeurl.trim()) {
                return res.json({
                    success: false,
                    error: 'Job hat externe URL - Kann nicht über Puppeteer geladen werden'
                });
            }
            
            // Launch Puppeteer with same settings as scraper
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            });
            
            const page = await browser.newPage();
            
            // Set user agent and viewport like in scraper
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await page.setViewport({ width: 1366, height: 768 });
            
            const arbeitsagenturUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
            
            // Navigate to page
            await page.goto(arbeitsagenturUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });
            
            // Wait a bit for dynamic content
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            let emails = [];
            let captchaSolved = false;
            
            // Extract emails if requested
            if (includeEmailExtraction) {
                try {
                    const emailExtractor = new EmailExtractor();
                    const captchaSolver = new IndependentCaptchaSolver();
                    
                    // Check for captcha first
                    const captchaSelector = 'img[src*="captcha"], img[alt*="captcha"], .captcha, #captcha';
                    const captchaExists = await page.$(captchaSelector);
                    
                    if (captchaExists) {
                        console.log('Captcha detected, attempting to solve...');
                        try {
                            await captchaSolver.solveCaptcha(page);
                            captchaSolved = true;
                            await page.waitForTimeout(2000); // Wait for page to update after captcha
                        } catch (captchaError) {
                            console.log('Captcha solving failed:', captchaError.message);
                        }
                    }
                    
                    // Extract emails from page content
                    const pageContent = await page.content();
                    const extractedEmails = emailExtractor.extractEmailsFromText(pageContent);
                    
                    // Also try to extract from visible text
                    const visibleText = await page.evaluate(() => {
                        return document.body.innerText || document.body.textContent || '';
                    });
                    
                    const visibleEmails = emailExtractor.extractEmailsFromText(visibleText);
                    
                    // Combine and deduplicate
                    const allEmails = [...new Set([...extractedEmails, ...visibleEmails])];
                    emails = emailExtractor.validateAndCleanEmails(allEmails);
                    
                } catch (extractionError) {
                    console.log('Email extraction error:', extractionError.message);
                }
            }
            
            // Take screenshot
            const screenshot = await page.screenshot({
                type: 'png',
                fullPage: true,
                quality: 80
            });
            
            const loadTime = Date.now() - startTime;
            
            res.json({
                success: true,
                screenshot: screenshot.toString('base64'),
                emails: emails,
                captchaSolved: captchaSolved,
                loadTime: loadTime,
                jobInfo: {
                    refnr: jobData.refnr,
                    titel: jobData.titel,
                    arbeitgeber: jobData.arbeitgeber
                }
            });
            
        } finally {
            if (browser) {
                await browser.close();
            }
        }
        
    } catch (error) {
        console.error('Puppeteer page error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API to get detailed scraping status
app.get('/api/scraping-status', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Get detailed scraping statistics - employer focused
            const statusQuery = `
                WITH employer_status AS (
                    SELECT 
                        j.arbeitgeber,
                        MAX(CASE WHEN j.externeurl IS NOT NULL AND j.externeurl != '' THEN 1 ELSE 0 END) as has_external_url,
                        MAX(CASE WHEN jd.best_email IS NOT NULL THEN 1 ELSE 0 END) as has_email,
                        MAX(CASE WHEN jd.reference_number IS NOT NULL THEN 1 ELSE 0 END) as has_been_scraped,
                        MAX(CASE WHEN jd.scraping_success = true THEN 1 ELSE 0 END) as scraping_successful,
                        MAX(CASE WHEN jd.scraping_success = false THEN 1 ELSE 0 END) as scraping_failed,
                        COUNT(*) as job_count
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                    WHERE j.is_active = true
                    GROUP BY j.arbeitgeber
                )
                SELECT 
                    'Total Employers' as category,
                    COUNT(*) as count,
                    'Unique job_scrp_employers in database' as description
                FROM employer_status
                
                UNION ALL
                
                SELECT 
                    'Jobs from API' as category,
                    (SELECT COUNT(*) FROM job_scrp_arbeitsagentur_jobs_v2 WHERE is_active = true) as count,
                    'Jobs scraped from Arbeitsagentur API' as description
                
                UNION ALL
                
                SELECT 
                    'Employers with External URLs' as category,
                    COUNT(*) as count,
                    'Employers with external URLs (cannot extract emails)' as description
                FROM employer_status
                WHERE has_external_url = 1
                
                UNION ALL
                
                SELECT 
                    'Employers Never Scraped' as category,
                    COUNT(*) as count,
                    'Employers ready for email extraction' as description
                FROM employer_status
                WHERE has_external_url = 0 AND has_been_scraped = 0
                
                UNION ALL
                
                SELECT 
                    'Employers Successfully Scraped' as category,
                    COUNT(*) as count,
                    'Employers that were successfully processed' as description
                FROM employer_status
                WHERE scraping_successful = 1
                
                UNION ALL
                
                SELECT 
                    'Employers with Failed Scraping' as category,
                    COUNT(*) as count,
                    'Employers where email extraction failed' as description
                FROM employer_status
                WHERE scraping_failed = 1
                
                UNION ALL
                
                SELECT 
                    'Employers with Emails Found' as category,
                    COUNT(*) as count,
                    'Employers with extracted email addresses' as description
                FROM employer_status
                WHERE has_email = 1
                
                ORDER BY category
            `;
            
            const result = await client.query(statusQuery);
            
            res.json({
                success: true,
                status: result.rows
            });
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Scraping status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to check 2captcha balance
app.get('/api/check-balance', async (req, res) => {
    try {
        const balanceCheckPath = path.join(__dirname, '../balance-check-simple.js');
        
        // Use child_process to run the balance check script
        const { exec } = require('child_process');
        
        exec(`/opt/homebrew/bin/node ${balanceCheckPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error('Balance check error:', error);
                console.error('stderr:', stderr);
                return res.json({ success: false, error: error.message });
            }
            
            // Parse balance from output
            const balanceMatch = stdout.trim().match(/^\$(\d+\.?\d*)$/);
            if (balanceMatch) {
                const balance = parseFloat(balanceMatch[1]);
                res.json({ 
                    success: true, 
                    balance: balance,
                    isLow: balance < 5
                });
            } else {
                console.error('Could not parse balance from output:', stdout);
                res.json({ success: false, error: 'Could not parse balance' });
            }
        });
        
    } catch (error) {
        console.error('Balance check error:', error);
        res.json({ success: false, error: error.message });
    }
});

// API endpoint to check Google API usage
app.get('/api/google-usage', async (req, res) => {
    try {
        // First try real-time monitor for more accurate data
        const GoogleAPIRealTimeMonitor = require('./google-api-real-time-monitor');
        const monitor = new GoogleAPIRealTimeMonitor();
        
        const realtimeStatus = await monitor.getCurrentQuotaStatus();
        
        // Always return real-time status data, even if never used
        res.json({
            success: true,
            daily_limit: realtimeStatus.daily_limit,
            queries_used: realtimeStatus.queries_used,
            queries_remaining: realtimeStatus.queries_remaining,
            usage_percentage: realtimeStatus.usage_percentage,
            last_query_time: realtimeStatus.last_check,
            is_warning: realtimeStatus.is_warning,
            is_exceeded: realtimeStatus.is_exceeded,
            can_continue: realtimeStatus.can_continue,
            message: realtimeStatus.last_check 
                ? (realtimeStatus.is_exceeded 
                    ? 'Google API quota exceeded!' 
                    : `${realtimeStatus.queries_remaining} queries remaining`)
                : 'No API calls made yet',
            source: 'real-time'
        });
        
        // Old if block removed
        if (false) {
            // Fallback to database tracker
            const GoogleAPIUsageTracker = require('./google-api-usage-tracker');
            const tracker = new GoogleAPIUsageTracker();
            
            const stats = await tracker.getUsageStats();
            const quotaStatus = await tracker.checkQuotaStatus();
            
            await tracker.close();
            
            res.json({
                success: true,
                ...stats,
                ...quotaStatus,
                source: 'database'
            });
        }
        
    } catch (error) {
        console.error('Google usage check error:', error);
        res.json({ 
            success: false, 
            error: error.message,
            queries_used: 0,
            queries_remaining: 100,
            usage_percentage: 0,
            daily_limit: 100
        });
    }
});

// API endpoint to test Google quota with real API call
app.post('/api/test-google-quota', async (req, res) => {
    try {
        const GoogleAPIRealTimeMonitor = require('./google-api-real-time-monitor');
        const monitor = new GoogleAPIRealTimeMonitor();
        
        // Use the API credentials from Large Tables
        const apiKey = 'AIzaSyBUv0IUn7f4OEfzPF8mqcdHf3X8ubcI7MU';
        const searchEngineId = '24f407b14f2344198';
        
        const result = await monitor.checkQuotaWithTestCall(apiKey, searchEngineId);
        
        if (result.success) {
            res.json({
                success: true,
                quotaState: result.quotaState,
                message: 'Quota checked successfully'
            });
        } else {
            res.json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('Google quota test error:', error);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Import the new domains integration route
const domainsIntegrationRoute = require('./domains-integration-route');

// Domains Integration Dashboard (replaces old employer-domains)
app.get('/domains-integration', (req, res) => domainsIntegrationRoute(req, res, pool));

// Keep old route for backward compatibility
app.get('/employer-domains', (req, res) => domainsIntegrationRoute(req, res, pool));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🌐 Combined Dashboard gestartet auf Port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔧 Health Check: http://localhost:${PORT}/health`);
    
    // Note: Puppeteer is only initialized on-demand when admin mode is actually used
    // This prevents unnecessary browser windows opening on dashboard startup
    console.log('📊 Dashboard ready - Puppeteer will initialize on-demand for admin mode');
});

module.exports = app;