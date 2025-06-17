const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

// Database connection
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/database.json'), 'utf8'));
const pool = new Pool(config.production);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Dashboard routes
app.get('/', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Today's statistics (using German timezone)
        const todayStats = await pool.query(`
            SELECT 
                COUNT(*) as total_today,
                COUNT(CASE WHEN data_source = 'api' THEN 1 END) as api_today,
                MIN(scraped_at AT TIME ZONE 'Europe/Berlin') as first_scan,
                MAX(scraped_at AT TIME ZONE 'Europe/Berlin') as last_scan
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE DATE(scraped_at AT TIME ZONE 'Europe/Berlin') = $1
        `, [today]);

        // Postal codes scanned today - REMOVED for performance
        // This query is no longer needed as the PLZ section was removed from dashboard
        const plzToday = { rows: [] }; // Empty result to avoid breaking code

        // New job_scrp_employers today (using German timezone)
        const newEmployersToday = await pool.query(`
            SELECT 
                arbeitgeber,
                COUNT(*) as position_count,
                string_agg(DISTINCT arbeitsort_plz, ', ') as plz_list
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE DATE(scraped_at AT TIME ZONE 'Europe/Berlin') = $1 
            AND data_source = 'api'
            GROUP BY arbeitgeber
            ORDER BY position_count DESC
            LIMIT 20
        `, [today]);

        // Scan activity by hour (using German timezone)
        const hourlyActivity = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM scraped_at AT TIME ZONE 'Europe/Berlin') as hour,
                COUNT(*) as scan_count
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE DATE(scraped_at AT TIME ZONE 'Europe/Berlin') = $1
            GROUP BY EXTRACT(HOUR FROM scraped_at AT TIME ZONE 'Europe/Berlin')
            ORDER BY hour
        `, [today]);

        // Weekly trends (using German timezone)
        const weeklyTrends = await pool.query(`
            SELECT 
                DATE(scraped_at AT TIME ZONE 'Europe/Berlin') as scan_date,
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN data_source = 'api' THEN 1 END) as new_jobs,
                COUNT(DISTINCT arbeitgeber) as unique_employers,
                COUNT(DISTINCT arbeitsort_plz) as unique_plz
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE scraped_at AT TIME ZONE 'Europe/Berlin' >= (CURRENT_DATE - INTERVAL '7 days')
            GROUP BY DATE(scraped_at AT TIME ZONE 'Europe/Berlin')
            ORDER BY scan_date DESC
        `);

        // Job details scraping statistics (using German timezone)
        const detailStats = await pool.query(`
            SELECT 
                COUNT(*) as total_details,
                COUNT(CASE WHEN scraped_at AT TIME ZONE 'Europe/Berlin' >= CURRENT_DATE THEN 1 END) as details_today,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as with_contact,
                COUNT(CASE WHEN scraping_success = true THEN 1 END) as successful,
                ROUND(AVG(scraping_duration_ms), 2) as avg_duration_ms
            FROM job_scrp_job_details
        `);

        // Recent detail scraping activity
        const recentDetails = await pool.query(`
            SELECT 
                jd.reference_number,
                aj.titel,
                aj.arbeitgeber,
                aj.arbeitsort_ort,
                jd.has_emails,
                jd.best_email,
                jd.email_count,
                jd.scraped_at AT TIME ZONE 'Europe/Berlin' as scraped_at_berlin
            FROM job_scrp_job_details jd
            LEFT JOIN job_scrp_arbeitsagentur_jobs_v2 aj ON jd.reference_number = aj.refnr
            WHERE jd.scraped_at AT TIME ZONE 'Europe/Berlin' >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY jd.scraped_at DESC
            LIMIT 10
        `);

        // Read scan status
        const statusFile = path.join(__dirname, '../scan-status.json');
        let scanStatus = { status: 'unknown', lastUpdate: null };
        try {
            scanStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        } catch (error) {
            // File doesn't exist yet
        }

        res.render('dashboard', {
            today: today,
            todayStats: todayStats.rows[0],
            plzToday: plzToday.rows,
            newEmployersToday: newEmployersToday.rows,
            hourlyActivity: hourlyActivity.rows,
            weeklyTrends: weeklyTrends.rows,
            scanStatus: scanStatus,
            detailStats: detailStats.rows[0] || {},
            recentDetails: recentDetails.rows
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Dashboard error: ' + error.message);
    }
});

// API endpoint for real-time status
app.get('/api/status', async (req, res) => {
    try {
        const statusFile = path.join(__dirname, '../scan-status.json');
        const logFile = path.join(__dirname, '../background-scan.log');
        
        let scanStatus = { status: 'unknown', lastUpdate: null };
        try {
            scanStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        } catch (error) {
            // File doesn't exist yet
        }

        // Get latest log entries
        let recentLogs = [];
        try {
            const logs = fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim());
            recentLogs = logs.slice(-10);
        } catch (error) {
            // Log file doesn't exist yet
        }

        res.json({
            scanStatus,
            recentLogs,
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for postal code details
app.get('/api/plz/:plz', async (req, res) => {
    try {
        const plz = req.params.plz;
        const today = new Date().toISOString().split('T')[0];
        
        const plzDetails = await pool.query(`
            SELECT 
                refnr,
                titel,
                beruf,
                arbeitgeber,
                aktuelleVeroeffentlichungsdatum,
                scraped_at,
                data_source
            FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE arbeitsort_plz = $1 
            AND DATE(scraped_at) = $2
            ORDER BY scraped_at DESC
            LIMIT 100
        `, [plz, today]);

        res.json(plzDetails.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Jobs listing page
app.get('/jobs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const plz = req.query.plz || '';
        const hasDetails = req.query.details === 'true';
        
        let whereClause = 'WHERE aj.is_active = true';
        let queryParams = [];
        let paramCount = 0;
        
        if (search) {
            paramCount++;
            whereClause += ` AND (aj.titel ILIKE $${paramCount} OR aj.arbeitgeber ILIKE $${paramCount} OR aj.beruf ILIKE $${paramCount})`;
            queryParams.push(`%${search}%`);
        }
        
        if (plz) {
            paramCount++;
            whereClause += ` AND aj.arbeitsort_plz = $${paramCount}`;
            queryParams.push(plz);
        }
        
        if (hasDetails) {
            whereClause += ` AND jd.reference_number IS NOT NULL`;
        }
        
        const countQuery = `
            SELECT COUNT(*) as total
            FROM job_scrp_arbeitsagentur_jobs_v2 aj
            LEFT JOIN job_scrp_job_details jd ON aj.refnr = jd.reference_number
            ${whereClause}
        `;
        
        const jobsQuery = `
            SELECT 
                aj.refnr,
                aj.titel,
                aj.beruf,
                aj.arbeitgeber,
                aj.arbeitsort_plz,
                aj.arbeitsort_ort,
                aj.aktuelleVeroeffentlichungsdatum,
                aj.scraped_at AT TIME ZONE 'Europe/Berlin' as scraped_at_berlin,
                jd.has_emails,
                jd.best_email,
                jd.email_count
            FROM job_scrp_arbeitsagentur_jobs_v2 aj
            LEFT JOIN job_scrp_job_details jd ON aj.refnr = jd.reference_number
            ${whereClause}
            ORDER BY aj.scraped_at DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        queryParams.push(limit, offset);
        
        const [countResult, jobsResult] = await Promise.all([
            pool.query(countQuery, queryParams.slice(0, -2)),
            pool.query(jobsQuery, queryParams)
        ]);
        
        const totalJobs = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(totalJobs / limit);
        
        res.render('jobs', {
            jobs: jobsResult.rows,
            currentPage: page,
            totalPages: totalPages,
            totalJobs: totalJobs,
            search: search,
            plz: plz,
            hasDetails: hasDetails
        });
        
    } catch (error) {
        console.error('Jobs page error:', error);
        res.status(500).send('Jobs page error: ' + error.message);
    }
});

// Job details page
app.get('/job/:refnr', async (req, res) => {
    try {
        const refnr = req.params.refnr;
        
        // Get job basic info
        const jobQuery = `
            SELECT * FROM job_scrp_arbeitsagentur_jobs_v2 
            WHERE refnr = $1
        `;
        const jobResult = await pool.query(jobQuery, [refnr]);
        
        if (jobResult.rows.length === 0) {
            return res.status(404).send('Job not found');
        }
        
        // Get job details if available
        const detailsQuery = `
            SELECT * FROM job_scrp_job_details 
            WHERE reference_number = $1
        `;
        const detailsResult = await pool.query(detailsQuery, [refnr]);
        
        res.render('job-detail', {
            job: jobResult.rows[0],
            details: detailsResult.rows[0] || null
        });
        
    } catch (error) {
        console.error('Job detail error:', error);
        res.status(500).send('Job detail error: ' + error.message);
    }
});

// PLZ details page
app.get('/plz/:plz', async (req, res) => {
    try {
        const plz = req.params.plz;
        
        // PLZ statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(DISTINCT arbeitgeber) as unique_employers,
                COUNT(CASE WHEN DATE(scraped_at AT TIME ZONE 'Europe/Berlin') = CURRENT_DATE THEN 1 END) as jobs_today,
                MIN(scraped_at AT TIME ZONE 'Europe/Berlin') as first_job,
                MAX(scraped_at AT TIME ZONE 'Europe/Berlin') as latest_job
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE arbeitsort_plz = $1 AND is_active = true
        `;
        
        // Recent jobs in this PLZ
        const jobsQuery = `
            SELECT 
                aj.refnr,
                aj.titel,
                aj.arbeitgeber,
                aj.beruf,
                aj.scraped_at AT TIME ZONE 'Europe/Berlin' as scraped_at_berlin,
                jd.has_emails,
                jd.email_count
            FROM job_scrp_arbeitsagentur_jobs_v2 aj
            LEFT JOIN job_scrp_job_details jd ON aj.refnr = jd.reference_number
            WHERE aj.arbeitsort_plz = $1 AND aj.is_active = true
            ORDER BY aj.scraped_at DESC
            LIMIT 50
        `;
        
        // Top job_scrp_employers in this PLZ
        const employersQuery = `
            SELECT 
                arbeitgeber,
                COUNT(*) as job_count,
                COUNT(CASE WHEN DATE(scraped_at AT TIME ZONE 'Europe/Berlin') = CURRENT_DATE THEN 1 END) as jobs_today
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE arbeitsort_plz = $1 AND is_active = true
            GROUP BY arbeitgeber
            ORDER BY job_count DESC
            LIMIT 20
        `;
        
        const [statsResult, jobsResult, employersResult] = await Promise.all([
            pool.query(statsQuery, [plz]),
            pool.query(jobsQuery, [plz]),
            pool.query(employersQuery, [plz])
        ]);
        
        res.render('plz-detail', {
            plz: plz,
            stats: statsResult.rows[0],
            jobs: jobsResult.rows,
            job_scrp_employers: employersResult.rows
        });
        
    } catch (error) {
        console.error('PLZ detail error:', error);
        res.status(500).send('PLZ detail error: ' + error.message);
    }
});

// External URLs dashboard
app.get('/external-urls', async (req, res) => {
    try {
        // Overview statistics
        const overviewQuery = `
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) as with_external_url,
                COUNT(CASE WHEN externeurl IS NULL OR externeurl = '' THEN 1 END) as without_external_url,
                ROUND(
                    COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) * 100.0 / COUNT(*), 2
                ) as external_url_percentage
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE is_active = true
        `;
        
        // Top job_scrp_employers with external URLs
        const topEmployersQuery = `
            SELECT 
                arbeitgeber,
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) as with_external_url,
                ROUND(
                    COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) * 100.0 / COUNT(*), 2
                ) as external_url_percentage
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE is_active = true
            GROUP BY arbeitgeber
            HAVING COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) > 0
            ORDER BY with_external_url DESC, total_jobs DESC
            LIMIT 50
        `;
        
        // External URL domains analysis
        const domainsQuery = `
            SELECT 
                CASE 
                    WHEN externeurl LIKE '%azubi.de%' THEN 'azubi.de'
                    WHEN externeurl LIKE '%stellenanzeigen.de%' THEN 'stellenanzeigen.de'
                    WHEN externeurl LIKE '%indeed.%' THEN 'indeed.com'
                    WHEN externeurl LIKE '%stepstone.%' THEN 'stepstone.de'
                    WHEN externeurl LIKE '%xing.%' THEN 'xing.com'
                    WHEN externeurl LIKE '%linkedin.%' THEN 'linkedin.com'
                    WHEN externeurl LIKE '%jobware.%' THEN 'jobware.de'
                    WHEN externeurl LIKE '%hogapage.%' THEN 'hogapage.de'
                    WHEN externeurl LIKE '%arbeitsagentur.%' THEN 'arbeitsagentur.de'
                    ELSE 'Andere'
                END as domain,
                COUNT(*) as job_count,
                COUNT(DISTINCT arbeitgeber) as unique_employers
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE externeurl IS NOT NULL AND externeurl != '' AND is_active = true
            GROUP BY 
                CASE 
                    WHEN externeurl LIKE '%azubi.de%' THEN 'azubi.de'
                    WHEN externeurl LIKE '%stellenanzeigen.de%' THEN 'stellenanzeigen.de'
                    WHEN externeurl LIKE '%indeed.%' THEN 'indeed.com'
                    WHEN externeurl LIKE '%stepstone.%' THEN 'stepstone.de'
                    WHEN externeurl LIKE '%xing.%' THEN 'xing.com'
                    WHEN externeurl LIKE '%linkedin.%' THEN 'linkedin.com'
                    WHEN externeurl LIKE '%jobware.%' THEN 'jobware.de'
                    WHEN externeurl LIKE '%hogapage.%' THEN 'hogapage.de'
                    WHEN externeurl LIKE '%arbeitsagentur.%' THEN 'arbeitsagentur.de'
                    ELSE 'Andere'
                END
            ORDER BY job_count DESC
        `;
        
        // Recent jobs with external URLs
        const recentJobsQuery = `
            SELECT 
                refnr,
                titel,
                arbeitgeber,
                arbeitsort_plz,
                arbeitsort_ort,
                externeurl,
                scraped_at AT TIME ZONE 'Europe/Berlin' as scraped_at_berlin
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE externeurl IS NOT NULL AND externeurl != '' AND is_active = true
            ORDER BY scraped_at DESC
            LIMIT 100
        `;
        
        // PLZ distribution for external URL jobs
        const plzDistributionQuery = `
            SELECT 
                arbeitsort_plz as plz,
                arbeitsort_ort as city,
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) as with_external_url,
                ROUND(
                    COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) * 100.0 / COUNT(*), 2
                ) as external_url_percentage
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE is_active = true AND arbeitsort_plz IS NOT NULL
            GROUP BY arbeitsort_plz, arbeitsort_ort
            HAVING COUNT(CASE WHEN externeurl IS NOT NULL AND externeurl != '' THEN 1 END) > 0
            ORDER BY with_external_url DESC
            LIMIT 30
        `;
        
        const [overviewResult, topEmployersResult, domainsResult, recentJobsResult, plzDistributionResult] = await Promise.all([
            pool.query(overviewQuery),
            pool.query(topEmployersQuery),
            pool.query(domainsQuery),
            pool.query(recentJobsQuery),
            pool.query(plzDistributionQuery)
        ]);
        
        res.render('external-urls', {
            overview: overviewResult.rows[0],
            topEmployers: topEmployersResult.rows,
            domains: domainsResult.rows,
            recentJobs: recentJobsResult.rows,
            plzDistribution: plzDistributionResult.rows
        });
        
    } catch (error) {
        console.error('External URLs page error:', error);
        res.status(500).send('External URLs page error: ' + error.message);
    }
});

// API: Export external URLs
app.get('/api/external-urls/export', async (req, res) => {
    try {
        const format = req.query.format || 'csv';
        
        const exportQuery = `
            SELECT 
                refnr,
                titel,
                arbeitgeber,
                arbeitsort_plz,
                arbeitsort_ort,
                externeurl,
                scraped_at AT TIME ZONE 'Europe/Berlin' as scraped_at_berlin,
                CASE 
                    WHEN externeurl LIKE '%azubi.de%' THEN 'azubi.de'
                    WHEN externeurl LIKE '%stellenanzeigen.de%' THEN 'stellenanzeigen.de'
                    WHEN externeurl LIKE '%indeed.%' THEN 'indeed.com'
                    WHEN externeurl LIKE '%stepstone.%' THEN 'stepstone.de'
                    WHEN externeurl LIKE '%xing.%' THEN 'xing.com'
                    WHEN externeurl LIKE '%linkedin.%' THEN 'linkedin.com'
                    WHEN externeurl LIKE '%jobware.%' THEN 'jobware.de'
                    WHEN externeurl LIKE '%hogapage.%' THEN 'hogapage.de'
                    WHEN externeurl LIKE '%arbeitsagentur.%' THEN 'arbeitsagentur.de'
                    ELSE 'Andere'
                END as domain_category
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE externeurl IS NOT NULL AND externeurl != '' AND is_active = true
            ORDER BY scraped_at DESC
        `;
        
        const result = await pool.query(exportQuery);
        
        if (format === 'csv') {
            const csv = [
                'refnr,titel,arbeitgeber,arbeitsort_plz,arbeitsort_ort,externeurl,scraped_at,domain_category',
                ...result.rows.map(row => 
                    `"${row.refnr}","${(row.titel || '').replace(/"/g, '""')}","${(row.arbeitgeber || '').replace(/"/g, '""')}","${row.arbeitsort_plz || ''}","${(row.arbeitsort_ort || '').replace(/"/g, '""')}","${row.externeurl}","${row.scraped_at_berlin}","${row.domain_category}"`
                )
            ].join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=external-urls-${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csv);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=external-urls-${new Date().toISOString().split('T')[0]}.json`);
            res.json({
                exported_at: new Date().toISOString(),
                total_records: result.rows.length,
                data: result.rows
            });
        }
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed: ' + error.message });
    }
});

// API: Analyze external URL patterns
app.get('/api/external-urls/analyze', async (req, res) => {
    try {
        // Analyze URL parameters
        const parametersQuery = `
            SELECT 
                CASE 
                    WHEN externeurl LIKE '%utm_source%' THEN 'utm_source'
                    WHEN externeurl LIKE '%utm_medium%' THEN 'utm_medium'
                    WHEN externeurl LIKE '%ref=%' THEN 'ref'
                    WHEN externeurl LIKE '%source=%' THEN 'source'
                    WHEN externeurl LIKE '%campaign%' THEN 'campaign'
                    WHEN externeurl LIKE '%jobId%' THEN 'jobId'
                    WHEN externeurl LIKE '%id=%' THEN 'id'
                    ELSE 'other'
                END as param,
                COUNT(*) as count
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE externeurl IS NOT NULL AND externeurl != '' AND is_active = true
            GROUP BY param
            ORDER BY count DESC
            LIMIT 10
        `;
        
        // Categorize domains
        const categoriesQuery = `
            SELECT 
                CASE 
                    WHEN externeurl LIKE '%azubi.de%' OR externeurl LIKE '%ausbildung%' THEN 'Ausbildung'
                    WHEN externeurl LIKE '%indeed.%' OR externeurl LIKE '%stepstone.%' OR externeurl LIKE '%xing.%' THEN 'Job-Portale'
                    WHEN externeurl LIKE '%stellenanzeigen.de%' THEN 'Stellenanzeigen'
                    WHEN externeurl LIKE '%linkedin.%' THEN 'Social Media'
                    WHEN externeurl LIKE '%arbeitsagentur.%' THEN 'Behörden'
                    ELSE 'Sonstige'
                END as category,
                COUNT(*) as count
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE externeurl IS NOT NULL AND externeurl != '' AND is_active = true
            GROUP BY category
            ORDER BY count DESC
        `;
        
        const [parametersResult, categoriesResult] = await Promise.all([
            pool.query(parametersQuery),
            pool.query(categoriesQuery)
        ]);
        
        // Generate insights
        const insights = [];
        const topCategory = categoriesResult.rows[0];
        const totalJobs = categoriesResult.rows.reduce((sum, cat) => sum + parseInt(cat.count), 0);
        
        if (topCategory) {
            insights.push(`${topCategory.category} ist die häufigste Kategorie mit ${topCategory.count} Jobs (${((topCategory.count / totalJobs) * 100).toFixed(1)}%)`);
        }
        
        if (parametersResult.rows.length > 0) {
            insights.push(`Die meisten URLs verwenden "${parametersResult.rows[0].param}" Parameter (${parametersResult.rows[0].count} URLs)`);
        }
        
        const jobPortalsCount = categoriesResult.rows.find(cat => cat.category === 'Job-Portale')?.count || 0;
        if (jobPortalsCount > 0) {
            insights.push(`${jobPortalsCount} Jobs werden über externe Job-Portale ausgeschrieben`);
        }
        
        insights.push(`Insgesamt ${totalJobs} Jobs mit externen URLs analysiert`);
        
        res.json({
            parameters: parametersResult.rows,
            categories: categoriesResult.rows,
            insights: insights,
            analysis_date: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('URL analysis error:', error);
        res.status(500).json({ error: 'Analysis failed: ' + error.message });
    }
});

// Keyword Scraping page
app.get('/keyword-scraping', async (req, res) => {
    try {
        // Get progress statistics
        const progressQuery = `
            SELECT 
                COUNT(*) as total_domains,
                COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted,
                COUNT(CASE WHEN email_extraction_attempted IS NULL OR email_extraction_attempted = false THEN 1 END) as remaining,
                COUNT(CASE WHEN emails_found > 0 THEN 1 END) as domains_with_emails,
                SUM(CASE WHEN emails_found > 0 THEN emails_found ELSE 0 END) as total_emails
            FROM job_scrp_domain_analysis
        `;
        
        // Get recent successful extractions
        const recentFindsQuery = `
            SELECT 
                domain,
                emails_found,
                frequency,
                last_extraction_date,
                notes
            FROM job_scrp_domain_analysis
            WHERE email_extraction_attempted = true 
            AND emails_found > 0
            ORDER BY last_extraction_date DESC
            LIMIT 10
        `;
        
        // Get top domains by email count
        const topDomainsQuery = `
            SELECT 
                domain,
                emails_found,
                frequency,
                last_extraction_date
            FROM job_scrp_domain_analysis
            WHERE emails_found > 0
            ORDER BY emails_found DESC, frequency DESC
            LIMIT 15
        `;
        
        const [progressResult, recentFindsResult, topDomainsResult] = await Promise.all([
            pool.query(progressQuery),
            pool.query(recentFindsQuery),
            pool.query(topDomainsQuery)
        ]);
        
        const progress = progressResult.rows[0];
        progress.percentage = Math.round((progress.attempted / progress.total_domains) * 100);
        
        // Calculate email statistics
        const emailStats = {
            total_emails: parseInt(progress.total_emails) || 0,
            domains_with_emails: parseInt(progress.domains_with_emails) || 0,
            success_rate: progress.attempted > 0 ? 
                Math.round((progress.domains_with_emails / progress.attempted) * 100) : 0,
            avg_emails: progress.domains_with_emails > 0 ? 
                (progress.total_emails / progress.domains_with_emails).toFixed(1) : '0.0'
        };
        
        // Get last run time from cron logs (if available)
        let lastRun = null;
        try {
            const fs = require('fs');
            const logPath = path.join(__dirname, '../logs/cron-keyword-scraper.log');
            if (fs.existsSync(logPath)) {
                const logContent = fs.readFileSync(logPath, 'utf8');
                const lines = logContent.split('\n');
                const lastLine = lines.reverse().find(line => line.includes('completed'));
                if (lastLine) {
                    const match = lastLine.match(/\[([\d-]+ [\d:]+)\]/);
                    if (match) {
                        lastRun = new Date(match[1]).toLocaleString('de-DE');
                    }
                }
            }
        } catch (error) {
            console.log('Could not read cron log:', error.message);
        }
        
        res.render('keyword-scraping', {
            progress,
            emailStats,
            recentFinds: recentFindsResult.rows,
            topDomains: topDomainsResult.rows,
            lastRun
        });
        
    } catch (error) {
        console.error('Keyword scraping page error:', error);
        res.status(500).send('Keyword scraping page error: ' + error.message);
    }
});

// Analytics page
app.get('/analytics', async (req, res) => {
    try {
        // Daily trends (last 14 days)
        const dailyTrendsQuery = `
            SELECT 
                DATE(scraped_at AT TIME ZONE 'Europe/Berlin') as date,
                COUNT(*) as total_jobs,
                COUNT(DISTINCT arbeitgeber) as unique_employers,
                COUNT(DISTINCT arbeitsort_plz) as unique_plz
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE scraped_at AT TIME ZONE 'Europe/Berlin' >= CURRENT_DATE - INTERVAL '14 days'
            GROUP BY DATE(scraped_at AT TIME ZONE 'Europe/Berlin')
            ORDER BY date DESC
        `;
        
        // Top PLZ by job count
        const topPlzQuery = `
            SELECT 
                arbeitsort_plz as plz,
                arbeitsort_ort as city,
                COUNT(*) as job_count,
                COUNT(DISTINCT arbeitgeber) as employer_count
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE is_active = true AND arbeitsort_plz IS NOT NULL
            GROUP BY arbeitsort_plz, arbeitsort_ort
            ORDER BY job_count DESC
            LIMIT 20
        `;
        
        // Top job_scrp_employers
        const topEmployersQuery = `
            SELECT 
                arbeitgeber,
                COUNT(*) as job_count,
                COUNT(DISTINCT arbeitsort_plz) as plz_count
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE is_active = true
            GROUP BY arbeitgeber
            ORDER BY job_count DESC
            LIMIT 20
        `;
        
        // Detail scraping analytics
        const detailAnalyticsQuery = `
            SELECT 
                DATE(scraped_at AT TIME ZONE 'Europe/Berlin') as date,
                COUNT(*) as details_scraped,
                COUNT(CASE WHEN has_emails = true THEN 1 END) as with_contact,
                AVG(scraping_duration_ms) as avg_duration
            FROM job_scrp_job_details
            WHERE scraped_at AT TIME ZONE 'Europe/Berlin' >= CURRENT_DATE - INTERVAL '14 days'
            GROUP BY DATE(scraped_at AT TIME ZONE 'Europe/Berlin')
            ORDER BY date DESC
        `;
        
        const [dailyTrends, topPlz, topEmployers, detailAnalytics] = await Promise.all([
            pool.query(dailyTrendsQuery),
            pool.query(topPlzQuery),
            pool.query(topEmployersQuery),
            pool.query(detailAnalyticsQuery)
        ]);
        
        res.render('analytics', {
            dailyTrends: dailyTrends.rows,
            topPlz: topPlz.rows,
            topEmployers: topEmployers.rows,
            detailAnalytics: detailAnalytics.rows
        });
        
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).send('Analytics error: ' + error.message);
    }
});

// Employer Domains Dashboard
app.get('/employer-domains', async (req, res) => {
    try {
        // Overall coverage statistics
        const coverageStats = await pool.query(`
            SELECT * FROM employer_coverage_stats
        `);

        // Top priority employers for Google search
        const priorityQueue = await pool.query(`
            SELECT 
                employer_name,
                employer_address,
                primary_location,
                active_jobs,
                total_jobs,
                latest_job_date,
                priority,
                value_score,
                has_google_search,
                verified_domain,
                has_emails
            FROM employer_search_queue
            WHERE priority <= 3  -- High priority only
            LIMIT 50
        `);

        // Recent Google search activity
        const recentActivity = await pool.query(`
            SELECT 
                activity_date,
                query_source,
                searches_performed,
                domains_verified,
                emails_found,
                unique_companies
            FROM google_search_activity
            WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days'
            ORDER BY activity_date DESC
        `);

        // PLZ region coverage
        const plzCoverage = await pool.query(`
            SELECT 
                plz_region,
                total_employers,
                searched_employers,
                with_domain,
                with_emails,
                total_active_jobs,
                search_coverage_pct
            FROM plz_coverage_stats
            WHERE total_active_jobs > 0
            ORDER BY total_active_jobs DESC
            LIMIT 20
        `);

        // Employers with most jobs but no domain
        const topMissingDomains = await pool.query(`
            SELECT 
                employer_name,
                primary_location,
                active_jobs,
                total_jobs,
                latest_job_date
            FROM employer_domain_coverage
            WHERE verified_domain IS NULL 
                AND active_jobs > 0
            ORDER BY active_jobs DESC
            LIMIT 20
        `);

        // Recent successful domain discoveries
        const recentSuccesses = await pool.query(`
            SELECT 
                gds.query_company_name,
                gds.result_domain,
                array_length(gds.all_emails, 1) as email_count,
                gds.domain_confidence,
                gds.created_at
            FROM google_domains_service gds
            WHERE gds.is_verified = true
                AND gds.all_emails IS NOT NULL
                AND array_length(gds.all_emails, 1) > 0
                AND gds.created_at >= CURRENT_DATE - INTERVAL '7 days'
            ORDER BY gds.created_at DESC
            LIMIT 20
        `);

        res.render('employer-domains', {
            stats: coverageStats.rows[0] || {},
            priorityQueue: priorityQueue.rows,
            recentActivity: recentActivity.rows,
            plzCoverage: plzCoverage.rows,
            topMissingDomains: topMissingDomains.rows,
            recentSuccesses: recentSuccesses.rows
        });

    } catch (error) {
        console.error('Employer domains dashboard error:', error);
        res.status(500).send('Dashboard error: ' + error.message);
    }
});

// API endpoint for employer domain stats
app.get('/api/employer-domains/stats', async (req, res) => {
    try {
        const stats = await pool.query('SELECT * FROM employer_coverage_stats');
        res.json(stats.rows[0] || {});
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for search queue
app.get('/api/employer-domains/queue', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const priority = parseInt(req.query.priority) || 5;
        
        const queue = await pool.query(`
            SELECT * FROM employer_search_queue 
            WHERE priority <= $1 
            ORDER BY priority ASC, value_score DESC 
            LIMIT $2
        `, [priority, limit]);
        
        res.json(queue.rows);
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`📊 Job Scraper Dashboard running at http://localhost:${port}`);
});

module.exports = app;