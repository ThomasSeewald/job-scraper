# CLAUDE.md - Job Scraper System

This file provides guidance to Claude Code when working with the job scraper system in this repository.

## Project Overview

The job scraper is a comprehensive automation system for extracting job listings and contact information from Arbeitsagentur (German Federal Employment Agency). It combines API data collection, web scraping with CAPTCHA solving, and email extraction.

## System Architecture

### Core Components

1. **API Data Collection**: Automated job listing discovery via Arbeitsagentur API
2. **Detail Scraping**: Contact information extraction from job detail pages
3. **CAPTCHA Automation**: Automatic CAPTCHA solving using 2captcha.com
4. **Email Extraction**: Prioritized email discovery and validation
5. **Progress Tracking**: Systematic coverage of all German postal codes
6. **Dashboard System**: Web-based monitoring and management interface

### Database Structure

- **Primary Database**: PostgreSQL on port 5473 (database: `jetzt`)
- **Main Tables**:
  - `arbeitsagentur_jobs_v2`: Job listings with metadata
  - `job_details`: Scraped contact information per job
  - `employers`: Aggregated employer contact data
  - `our_sql_postal_code`: German postal code database

## Cron Job System

Four automated processes run on different schedules:

### 1. API Collection (`cron-scan.sh`) - Every 4 hours
- **Purpose**: Complete postal code coverage with 14-day lookback
- **Strategy**: Progressive scanning of all 8,288 German postal codes
- **Batch size**: 200 postal codes per run
- **Cycle**: 14-day complete coverage cycle
- **Output**: New jobs marked with `old = false`

### 2. New Employer Detail Scraping (`cron-detail-scraper.sh`) - Every 2 hours
- **Purpose**: Extract emails from newly discovered employers
- **Target**: Employers from recent jobs (`old = false`)
- **Batch size**: 50 employers per run
- **Features**: CAPTCHA automation, headless browser operation
- **Priority**: High (immediate processing of new data)

### 3. Historical Employer Scraping (`cron-historical-scraper.sh`) - Every 6 hours
- **Purpose**: Process historical employer backlog (~156,000 employers)
- **Target**: Employers never attempted for email extraction
- **Batch size**: 30 employers per run (slower pace)
- **Strategy**: Progressive processing with position tracking
- **Progress**: Tracked in `historical-progress.json`

### 4. Daily Fresh Scan (`cron-daily-fresh.sh`) - Daily at 6 AM
- **Purpose**: Complete coverage for very recent jobs (2-day lookback)
- **Strategy**: Scan ALL postal codes for freshest opportunities
- **Complements**: The 14-day progressive scan

### 5. Keyword Domain Scraper (`cron-keyword-scraper.sh`) - Every 30 minutes
- **Purpose**: Extract emails from company domains using keyword-based page detection
- **Target**: 7,001 domains from domain_analysis table that haven't been attempted
- **Strategy**: Independent operation, searches for impressum/kontakt/karriere/jobs pages
- **Keywords**: German + English variants (impressum, kontakt, karriere, jobs, contact, career)
- **Database**: Updates domain_analysis table with email count and detailed notes
- **Success Rate**: ~4.4 emails per domain average (optimized batch testing)
- **Batch Size**: 25 domains per 30-minute interval (optimized for reliability)
- **Progress**: Automatic completion when all domains processed

## Key Scripts and Files

### Main Executables
- `run-complete-background-scan.js`: Complete PLZ coverage with 14-day cycles + job lifecycle tracking
- `src/newest-jobs-scraper.js`: New employer detail scraping with 404 detection
- `src/historical-employer-scraper.js`: Historical employer processing with 404 detection
- `daily-fresh-scanner.js`: Fresh job discovery
- `src/keyword-domain-scraper.js`: Keyword-based email extraction from company domains
- `src/scraper-supervisor.js`: Process supervision and automatic restart management
- `src/intelligent-api-scraper.js`: API scraping with job lifecycle tracking

### Dashboard System
- `dashboard/server.js`: Main dashboard web server (Port 3000)
- `dashboard/views/`: EJS templates for web interface
  - `dashboard.ejs`: Main dashboard with statistics and controls
  - `jobs.ejs`: Job listings browser with search and filtering
  - `external-urls.ejs`: External URL management and monitoring
  - `job-detail.ejs`: Individual job detail view
  - `analytics.ejs`: Analytics and reporting interface
  - `plz-detail.ejs`: Postal code analysis view

### Configuration
- `config/database.json`: Database connection settings
- `src/independent-captcha-solver.js`: 2captcha.com integration
- `src/email-extractor.js`: Email discovery and validation logic

### Progress Tracking
- `plz-progress.json`: 14-day postal code cycle progress
- `historical-progress.json`: Historical employer processing position
- `scan-status.json`: Current scan status

### Logs
- `logs/cron-scan.log`: API collection logs
- `logs/cron-detail-scraper.log`: New employer scraping logs
- `logs/cron-historical-scraper.log`: Historical scraping logs
- `logs/daily-fresh.log`: Daily fresh scan logs
- `logs/balance-monitor.log`: 2captcha.com balance tracking
- `logs/supervisor.log`: Process supervision and restart activity

## CAPTCHA Automation

### Integration
- **Service**: 2captcha.com API
- **Type**: Image-based CAPTCHAs from Arbeitsagentur
- **Validation**: 6-character alphanumeric solutions
- **Success Rate**: >80% automated solving
- **Fallback**: 3 retry attempts per CAPTCHA

### Implementation
- **Headless Mode**: Background operation for cron jobs
- **Image Extraction**: Direct download from CAPTCHA URLs
- **Form Submission**: Automated input and button clicking
- **Validation**: Text-based confirmation of successful solving

## Email Extraction Strategy

### Priority System
1. **"@" words first**: Direct email addresses in content
2. **Job-specific domains**: Prioritize job-relevant email patterns
3. **Contact sections**: Focus on dedicated contact areas
4. **Application websites**: Extract when emails not available

### Data Storage
- **job_details table**: Individual job contact information
- **employers table**: Aggregated employer contact data
- **Deduplication**: Avoid re-scraping already processed employers

## Python Scrapers (Current Production System)

### Overview
As of January 2025, we have transitioned from Node.js scrapers to Python-based scrapers using Playwright for better performance, reliability, and maintainability.

### Active Python Scrapers

#### 1. Four Window Unified Scraper (`four_window_unified.py`) - PRIMARY
- **Purpose**: Main production scraper for employer email extraction
- **Location**: `/python_scrapers/four_window_unified.py`
- **Key Features**:
  - Runs 4 parallel workers in separate browser windows (red, green, blue, orange)
  - Worker IDs: 0 (red), 1 (blue), 2 (green), 3 (orange)
  - Atomic employer claiming prevents duplicate processing
  - Visual monitoring - each window shows worker progress
  - Automatic CAPTCHA solving via 2captcha.com
  - Cookie persistence for session continuity
  - Handles 404 detection to save CAPTCHA credits
  - Headless mode support with `--headless` flag
- **Usage**: 
  - Visible mode: `python3 four_window_unified.py`
  - Headless mode: `python3 four_window_unified.py --headless`
  - Background: `nohup python3 four_window_unified.py --headless > four_window.log 2>&1 &`
- **Log files**: Each worker creates its own log: `worker-0.log`, `worker-1.log`, `worker-2.log`, `worker-3.log`

#### 2. Unified Scraper with Keywords (`unified_scraper_with_keywords.py`)
- **Purpose**: Enhanced scraper that searches company domains for keyword-based email extraction
- **Location**: `/python_scrapers/unified_scraper_with_keywords.py`
- **Features**:
  - All features of unified scraper PLUS
  - Keyword-based domain searching (impressum, kontakt, karriere, jobs)
  - Extracts emails from company websites when job detail has no email
  - Updates additional database columns for keyword-found emails
- **Note**: Currently has database schema issues (missing refnr column)

#### 3. Standard Unified Scraper (`unified_scraper.py`)
- **Purpose**: Base scraper module used by the four-window system and dashboard-initiated extractions
- **Features**:
  - Single worker implementation
  - Configurable batch size and delays
  - Comprehensive logging
  - Email extraction using "@-words first" approach
  - Supports both batch and continuous modes
- **Special Usage - Dashboard Email Extraction**:
  - Worker ID 99 is reserved for dashboard-initiated extractions
  - Started from Email Search page at `/email-search`
  - Always runs with `--mode batch --worker-id 99`
  - Processes specific employers marked by the search results

### Why Python Scrapers?

#### Performance Improvements
1. **Speed**: 2-3 seconds per job (vs 10-20 seconds with Node.js)
2. **Database**: Atomic claiming query executes in 1-2 seconds (vs 20-30 seconds)
3. **Memory**: More efficient memory usage with Playwright
4. **Stability**: Better error handling and recovery

#### Technical Advantages
1. **Playwright**: Superior to Puppeteer for automation
   - Better cookie handling
   - More stable browser contexts
   - Built-in wait strategies
2. **Async/Await**: Native Python async for concurrent operations
3. **Database**: Psycopg2 with proper connection pooling
4. **Logging**: Structured logging with color-coded output

#### Operational Benefits
1. **Visual Monitoring**: 4-window display for real-time observation
2. **No Duplicates**: Atomic database operations prevent double processing
3. **Cookie Persistence**: Maintains session across multiple jobs
4. **Error Recovery**: Automatic retry on failures

### Database Integration
```sql
-- Atomic employer claiming query used by Python scrapers
UPDATE employers 
SET is_being_scraped = true, 
    last_scraped_at = NOW()
WHERE id IN (
    SELECT id FROM employers 
    WHERE email_extraction_attempted = false 
    AND is_being_scraped = false
    ORDER BY id DESC 
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING id, name, ...
```

### Common Commands
```bash
# Start 4-window scraper (foreground)
cd /Users/thomassee/Docker/containers/job-scraper/python_scrapers
python3 four_window_unified.py

# Start in background
nohup python3 four_window_unified.py > four_window_unified.log 2>&1 &

# Monitor logs
tail -f four_window_unified.log

# Kill all Python scrapers
pkill -f "python.*unified"

# Check running scrapers
ps aux | grep python | grep unified
```

### Migration from Node.js
- Node.js scrapers (`src/newest-jobs-scraper.js`, `src/historical-employer-scraper.js`) are now deprecated
- Python scrapers handle both new and historical employer processing
- Cron jobs have been updated to use Python scrapers
- Dashboard remains Node.js-based but scraping is all Python

## Development Commands

### Manual Execution (Node.js - Legacy)
```bash
# Test new employer scraping (10 jobs)
node src/newest-jobs-scraper.js 10

# Test historical scraping (5 employers)
node src/historical-employer-scraper.js 5

# Run single API collection cycle
node run-complete-background-scan.js --once

# Test daily fresh scan
node daily-fresh-scanner.js

# Check 2captcha balance
node balance-check.js

# Test keyword domain scraping (5 domains)
node src/keyword-domain-scraper.js 5

# Setup keyword scraper cron job
./setup-keyword-scraper.sh

# Start scraper supervisor
node src/scraper-supervisor.js

# Install supervisor as LaunchD service
./install-supervisor.sh
```

### Cron Management
```bash
# View current cron jobs
crontab -l

# Check specific cron logs
tail -f logs/cron-detail-scraper.log
tail -f logs/cron-historical-scraper.log
tail -f logs/cron-keyword-scraper.log

# Manual cron execution
./cron-detail-scraper.sh
./cron-historical-scraper.sh
./cron-keyword-scraper.sh
```

### Database Queries
```sql
-- Check recent scraping activity
SELECT COUNT(*) FROM job_details WHERE scraped_at > CURRENT_TIMESTAMP - INTERVAL '2 hour';

-- Check job lifecycle statistics
SELECT 
    COUNT(*) as total_jobs,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_jobs,
    COUNT(CASE WHEN marked_inactive_date IS NOT NULL THEN 1 END) as inactive_jobs,
    AVG(api_check_count) as avg_checks_per_job
FROM arbeitsagentur_jobs_v2;

-- View new vs old job distribution
SELECT old, COUNT(*) FROM arbeitsagentur_jobs_v2 GROUP BY old;

-- Check employer extraction status
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN email_extraction_attempted = true THEN 1 END) as attempted
FROM employers;

-- Find recent email extractions
SELECT e.name, e.contact_emails, e.website 
FROM employers e 
WHERE e.email_extraction_date > CURRENT_TIMESTAMP - INTERVAL '1 hour';

-- Check keyword scraping progress
SELECT 
    COUNT(*) as total_domains,
    COUNT(CASE WHEN scraped_for_keywords = true THEN 1 END) as scraped,
    COUNT(CASE WHEN impressum_emails IS NOT NULL THEN 1 END) as with_impressum,
    COUNT(CASE WHEN kontakt_emails IS NOT NULL THEN 1 END) as with_kontakt,
    COUNT(CASE WHEN karriere_emails IS NOT NULL THEN 1 END) as with_karriere,
    COUNT(CASE WHEN jobs_emails IS NOT NULL THEN 1 END) as with_jobs
FROM job_details 
WHERE company_domain IS NOT NULL AND company_domain != '';

-- Find domains with keyword-extracted emails
SELECT 
    company_domain,
    impressum_emails,
    kontakt_emails,
    karriere_emails,
    jobs_emails,
    updated_at
FROM job_details 
WHERE scraped_for_keywords = true 
AND (impressum_emails IS NOT NULL OR kontakt_emails IS NOT NULL OR karriere_emails IS NOT NULL OR jobs_emails IS NOT NULL)
ORDER BY updated_at DESC
LIMIT 20;
```

## Performance Metrics

### Expected Daily Processing
- **API calls**: ~1,200 postal codes (200 PLZ × 6 runs)
- **New employer emails**: ~100-300 employers
- **Historical emails**: ~120 employers
- **CAPTCHA solving**: ~200-500 CAPTCHAs
- **Total email extractions**: ~220-420 employers/day

### System Efficiency
- **Complete Germany coverage**: Every ~7 days (progressive)
- **Fresh job coverage**: Daily (2-day lookback)
- **Historical backlog**: ~3.6 years to complete at current rate
- **CAPTCHA success rate**: >80%
- **Email discovery rate**: ~60% when available

## Environment Variables

### Production Settings
- `NODE_ENV=production`: Production database configuration
- `HEADLESS_MODE=true`: Background browser operation for cron jobs

### Development Settings
- Omit `HEADLESS_MODE` for visible browser debugging
- Use development database configuration for testing

## Dashboard Interface

### Access Points
- **Local Development**: http://localhost:3001
- **Email Search**: http://localhost:3001/email-search
- **Production**: Configured through nginx proxy

### Key Features
1. **Main Dashboard** (`/`)
   - Real-time system statistics
   - Active scraping sessions monitoring
   - Database overview and metrics
   - Quick action buttons for manual operations

2. **Email Search** (`/email-search`) - PRIMARY INTERFACE
   - Advanced search for jobs with/without emails
   - Filters: job type, location, company, email domain, job category, external URLs
   - Group by employer option to avoid duplicate emails
   - CSV export functionality (GET request to `/api/export-emails-csv`)
   - **Email Extraction Button**: 
     - Appears when searching for jobs without emails
     - Shows count of jobs ready for extraction
     - Two confirmation dialogs when clicked
     - Starts Python scraper with worker ID 99
     - Headless mode checkbox controls browser visibility

3. **Job Browser** (`/jobs`)
   - Searchable job listings with pagination
   - Advanced filtering by location, keywords, dates
   - Export functionality (CSV, JSON)
   - Individual job detail access

4. **External URLs Monitor** (`/external-urls`)
   - Track jobs that redirect away from Arbeitsagentur
   - URL categorization and analysis
   - Bulk processing capabilities
   - Success rate monitoring

5. **Analytics Dashboard** (`/analytics`)
   - Postal code performance metrics
   - Email extraction success rates
   - Historical trends and patterns
   - Geographic distribution analysis

6. **System Controls**
   - Manual scraping triggers
   - Progress monitoring
   - Configuration management
   - Log file access

### Dashboard Commands
```bash
# Start combined dashboard server (includes email search)
cd /Users/thomassee/Docker/containers/job-scraper/src
node combined-dashboard.js

# Or run in background
nohup node src/combined-dashboard.js > dashboard.log 2>&1 &

# View dashboard logs
tail -f dashboard.log

# Stop dashboard
pkill -f "node.*combined-dashboard.js"

# Check if email extraction is running (worker ID 99)
ps aux | grep "worker-id 99"
```

## Troubleshooting

### Common Issues
1. **CAPTCHA failures**: Check 2captcha.com balance and service status
2. **Browser crashes**: Restart cron jobs, check system memory
3. **Database connections**: Verify PostgreSQL service on port 5473
4. **Missing emails**: Check for external URLs (redirects away from Arbeitsagentur)

### Health Checks
```bash
# Check if cron jobs are running
ps aux | grep -E "(cron-|background-scan|daily-fresh)" | grep -v grep

# Check supervisor status
launchctl list | grep com.jobscraper.supervisor

# View supervisor logs
tail -f logs/supervisor.log

# Verify database connectivity
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -c "SELECT COUNT(*) FROM arbeitsagentur_jobs_v2;"

# Test CAPTCHA solver
node -e "const solver = require('./src/independent-captcha-solver'); new solver().test()"

# Check dashboard server status
curl http://localhost:3000/api/stats

# Test dashboard connectivity
curl -I http://localhost:3000

# Check job lifecycle stats
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -c "SELECT is_active, COUNT(*) FROM arbeitsagentur_jobs_v2 GROUP BY is_active;"
```

### Log Analysis
```bash
# Check for recent errors
grep -i error logs/cron-*.log | tail -20

# Monitor real-time activity
tail -f logs/cron-detail-scraper.log

# Check CAPTCHA success rates
grep -c "CAPTCHA solved successfully" logs/cron-detail-scraper.log
```

## API Rate Limits

### Arbeitsagentur API
- **Conservative approach**: 500ms delays between postal code requests
- **Batch processing**: Process postal codes in groups
- **Error handling**: Automatic retries with exponential backoff

### 2captcha.com
- **Concurrent limits**: Multiple CAPTCHA submissions supported
- **Balance monitoring**: Automatic balance checks after each scraping session
- **Cost management**: ~$0.001 per CAPTCHA solved

## Security Considerations

### API Keys
- 2captcha.com API key stored in `src/independent-captcha-solver.js`
- Database credentials in `config/database.json`
- No external URL following (prevents redirects to malicious sites)

### Browser Security
- Sandboxed browser execution
- No persistent cookies or sessions
- Automated cleanup of temporary files

## Current Status & Completed Features

### Recently Completed (January 2025)
- ✅ **Dashboard Interface**: Full web-based management system
- ✅ **External URL Monitoring**: Track and analyze redirect patterns
- ✅ **Advanced Analytics**: Postal code and performance metrics
- ✅ **Job Browser**: Searchable interface with export capabilities
- ✅ **Real-time Statistics**: Live system monitoring and metrics
- ✅ **Bulk Operations**: Mass processing and data management tools
- ✅ **Keyword Domain Scraper**: Independent email extraction from company domains
- ✅ **404 Detection**: Saves CAPTCHA credits by detecting expired jobs before solving
- ✅ **Process Supervision**: Automatic restart mechanism with scraper-supervisor.js
- ✅ **Job Lifecycle Tracking**: Database columns for tracking job availability over time

### Active Development Areas
- 🔄 **External URL Processing**: Improving redirect handling and categorization
- 🔄 **Performance Optimization**: Database query optimization and caching
- 🔄 **Error Handling**: Enhanced CAPTCHA failure recovery
- 🔄 **Monitoring Improvements**: Better system health tracking

## Recent Improvements (January 2025)

### 1. 404 Detection (Immediate CAPTCHA Savings)
- Added to both `newest-jobs-scraper.js` and `historical-employer-scraper.js`
- Detects expired job pages (404 errors) before attempting CAPTCHA solving
- Marks jobs as inactive when 404 detected
- Expected savings: 50%+ reduction in CAPTCHA usage

### 2. Automatic Restart Mechanism (24/7 Reliability)
- **Scraper Supervisor** (`src/scraper-supervisor.js`): Central process manager
- **LaunchD Integration**: System-level service for automatic startup
- **Health Monitoring**: Heartbeat checks and automatic restart on failure
- **Parallel Scraper Enhancement**: Modified to include auto-restart logic

### 3. Job Lifecycle Tracking (Database Intelligence)
- New columns: `last_seen_in_api`, `api_check_count`, `marked_inactive_date`
- API scanner tracks when each job was last seen
- Jobs not seen for 7+ days automatically marked as inactive
- Enables intelligent decisions about which employers to scrape

## Future Enhancements

### Potential Improvements
1. **Machine learning**: Train custom CAPTCHA solver
2. **Parallel processing**: Multiple browser instances with resource management
3. **Advanced email validation**: SMTP verification of discovered emails
4. **Geographic optimization**: Regional prioritization based on success rates
5. **API integrations**: Connect with CRM and recruitment systems
6. **Mobile interface**: Responsive dashboard design
7. **Automated reporting**: Scheduled analytics reports

### Scalability Considerations
- Current system designed for single-machine operation
- Database can handle millions of records
- CAPTCHA solving is the primary bottleneck
- Network bandwidth adequate for current load

## Data Quality

### Email Validation
- Format validation (RFC 5322 compliance)
- Domain verification where possible
- Deduplication across employers
- Source tracking for audit trails

### Employer Deduplication
- Normalized name matching
- Multiple location handling
- Subsidiary relationship tracking
- Contact information consolidation

This system provides comprehensive coverage of the German job market with automated contact discovery, making it valuable for recruitment, market research, and employment analytics.