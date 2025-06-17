# Job Scraper System - Scraper Documentation

## Overview

The Job Scraper System is a comprehensive automation solution for extracting job listings and employer contact information from Arbeitsagentur (German Federal Employment Agency). The system uses multiple specialized scrapers that work together to build a complete database of German job opportunities with contact details.

## Recent Improvements (January 2025)

### 1. **404 Detection** - Saves CAPTCHA Credits
- Automatically detects expired job pages (404 errors) BEFORE attempting CAPTCHA solving
- Prevents wasting CAPTCHA credits on non-existent pages
- Marks jobs as inactive in database when 404 detected
- Implemented in both newest-jobs-scraper and historical-employer-scraper
- Expected savings: 50%+ reduction in CAPTCHA usage

### 2. **Automatic Restart Mechanism** - 24/7 Reliability
- **Scraper Supervisor**: New process monitoring system that automatically restarts crashed scrapers
- **LaunchD Integration**: System-level service ensures supervisor runs at startup
- **Exponential Backoff**: Smart retry logic prevents rapid restart loops
- **Parallel Scraper Auto-Restart**: Modified to automatically recover from failures
- Result: Scrapers now run continuously without manual intervention

### 3. **Job Lifecycle Tracking** - Database Intelligence
- New database columns: `last_seen_in_api`, `api_check_count`, `marked_inactive_date`
- API scanner now tracks when each job was last seen
- Jobs not seen for 7+ days are automatically marked as inactive
- Enables intelligent scraping decisions based on job availability
- Prevents scraping employers with only inactive jobs

## Scraper Types and Their Functions

### 1. API Collection Scraper (`cron-scan.sh`)
**What it does:** Collects job listings through the official Arbeitsagentur API
- Scans all 8,288 German postal codes (PLZ) systematically
- Retrieves job listings with a 14-day lookback period
- Processes 200 postal codes per run (every 4 hours)
- Marks new jobs with `old = false` flag
- Completes full Germany coverage every 14 days

**When it runs:** Every 4 hours via cron job
**Why it's needed:** Provides the foundational job data that other scrapers will enrich with contact information

### 2. New Employer Detail Scraper (`cron-detail-scraper.sh`)
**What it does:** Extracts contact emails from newly discovered employers
- Targets employers from recent API collection (`old = false`)
- Visits individual job detail pages on Arbeitsagentur website
- Automatically solves CAPTCHAs using 2captcha.com service
- Extracts email addresses, phone numbers, and application websites
- Processes 50 employers per run

**When it runs:** Every 2 hours via cron job
**Why it's needed:** Quickly captures contact information for fresh job opportunities before they expire

### 3. Historical Employer Scraper (`cron-historical-scraper.sh`)
**What it does:** Processes the backlog of ~156,000 historical employers
- Works through employers that have never been attempted for email extraction
- Uses a slower, more thorough approach to maximize data extraction
- Maintains position tracking to avoid reprocessing
- Processes 30 employers per run (slower pace for stability)

**When it runs:** Every 6 hours via cron job
**Why it's needed:** Ensures comprehensive coverage of all employers in the database, including older entries

### 4. Daily Fresh Scanner (`cron-daily-fresh.sh`)
**What it does:** Performs a complete scan for very recent jobs
- Scans ALL postal codes with only 2-day lookback
- Captures the freshest job opportunities
- Complements the progressive 14-day scan
- Ensures no new opportunities are missed

**When it runs:** Daily at 6 AM via cron job
**Why it's needed:** Provides immediate access to brand new job postings that require quick action

### 5. Keyword Domain Scraper (`cron-keyword-scraper.sh`)
**What it does:** Extracts emails directly from company websites
- Targets 7,001 company domains identified in the database
- Searches for standard contact pages (impressum, kontakt, karriere, jobs)
- Works independently of Arbeitsagentur website
- Updates domain_analysis table with findings
- Achieves ~4.4 emails per domain average

**When it runs:** Every 30 minutes via cron job
**Why it's needed:** Captures emails that may not be listed on job postings but are available on company websites

## Data Flow

```
1. API Collection → Discovers new jobs → Updates arbeitsagentur_jobs_v2 table
                                      ↓
2. New Employer Scraper → Extracts emails from fresh jobs → Updates job_details + employers tables
                                      ↓
3. Historical Scraper → Fills gaps for older employers → Updates job_details + employers tables
                                      ↓
4. Keyword Domain Scraper → Enriches with website emails → Updates domain_analysis table
                                      ↓
5. Daily Fresh Scanner → Ensures no opportunities missed → Updates all relevant tables
```

## CAPTCHA Handling

All scrapers that visit Arbeitsagentur detail pages include automated CAPTCHA solving:
- Integration with 2captcha.com API service
- Automatic image download and submission
- 3 retry attempts per CAPTCHA
- Success rate >80%
- Cost: ~$0.001 per CAPTCHA

## Email Extraction Strategy

The scrapers use a prioritized approach to find emails:
1. **Direct email addresses** - Text containing "@" symbols
2. **Job-specific patterns** - Common HR email formats (bewerbung@, karriere@, jobs@)
3. **Contact sections** - Dedicated contact areas on pages
4. **Application websites** - External career portals when direct emails unavailable

## Database Tables Updated

- **arbeitsagentur_jobs_v2** - Main job listings table
- **job_details** - Detailed contact information per job
- **employers** - Aggregated employer contact data
- **domain_analysis** - Website-based email findings

## Performance Metrics

### Daily Processing Capacity:
- API calls: ~1,200 postal codes
- New employer emails: ~100-300 employers
- Historical emails: ~120 employers
- Keyword domain emails: ~1,200 domains
- CAPTCHA solving: ~200-500 per day
- Total email extractions: ~500-800 per day

### Coverage Statistics:
- Complete Germany scan: Every 7 days (progressive)
- Fresh job coverage: Daily (2-day lookback)
- Historical backlog completion: ~3.6 years at current rate
- Email discovery success rate: ~60% when available

## Manual Execution

All scrapers can be run manually for testing or immediate processing:

```bash
# Run API collection once
node run-complete-background-scan.js --once

# Process 10 new employers
node src/newest-jobs-scraper.js 10

# Process 5 historical employers
node src/historical-employer-scraper.js 5

# Run daily fresh scan
node daily-fresh-scanner.js

# Process 5 domains for keywords
node src/keyword-domain-scraper.js 5
```

## Monitoring

The system provides multiple monitoring options:
- Web dashboard at http://localhost:3001
- Log files in `logs/` directory
- Database queries for real-time statistics
- Email search interface for data exploration

## System Architecture Features

### Process Supervision
The system now includes a robust process supervision architecture:
- **Scraper Supervisor** (`src/scraper-supervisor.js`): Central process manager
- **Automatic Restart**: All scrapers restart automatically on failure
- **Health Monitoring**: Heartbeat checks ensure scrapers are responsive
- **LaunchD Service**: macOS system integration for boot startup

### Intelligent Scraping
- **404 Detection**: Checks page availability before CAPTCHA solving
- **Job Lifecycle**: Tracks job availability over time
- **Employer Grouping**: Processes all jobs per employer together
- **Duplicate Prevention**: Avoids re-scraping completed employers

## Monitoring and Management

### Supervisor Commands
```bash
# Check supervisor status
launchctl list | grep com.jobscraper.supervisor

# View supervisor logs
tail -f logs/supervisor.log

# Restart supervisor
launchctl unload ~/Library/LaunchAgents/com.jobscraper.supervisor.plist
launchctl load ~/Library/LaunchAgents/com.jobscraper.supervisor.plist
```

### Database Monitoring
```sql
-- Check job lifecycle statistics
SELECT 
    COUNT(*) as total_jobs,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_jobs,
    COUNT(CASE WHEN marked_inactive_date IS NOT NULL THEN 1 END) as inactive_jobs,
    AVG(api_check_count) as avg_checks_per_job
FROM job_scrp_arbeitsagentur_jobs_v2;

-- View recently marked inactive jobs
SELECT refnr, titel, arbeitgeber, marked_inactive_date 
FROM job_scrp_arbeitsagentur_jobs_v2 
WHERE marked_inactive_date > CURRENT_TIMESTAMP - INTERVAL '1 day'
ORDER BY marked_inactive_date DESC
LIMIT 20;
```

## Why This Architecture?

1. **Separation of Concerns** - Each scraper has a specific role, preventing conflicts
2. **Fault Tolerance** - Automatic restart ensures continuous operation
3. **Cost Efficiency** - 404 detection saves 50%+ of CAPTCHA credits
4. **Database Intelligence** - Job lifecycle tracking enables smart decisions
5. **24/7 Operation** - System-level integration ensures always-running scrapers
6. **Comprehensive Coverage** - Multiple approaches ensure maximum data extraction
7. **Fresh Data Priority** - New opportunities get immediate attention