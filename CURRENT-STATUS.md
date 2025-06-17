# Current Scraping Status - June 6, 2025

## Active Processes

### 3 Batch Employer Scrapers Running
- **Process 1**: PID 46942 (batch file: temp_batch_1.json)
- **Process 2**: PID 46981 (batch file: temp_batch_2.json)  
- **Process 3**: PID 47032 (batch file: temp_batch_3.json)
- **Mode**: Non-headless (visible browser windows)
- **Started**: 19:17 UTC

### Dashboard Server
- **Status**: Running
- **URL**: http://localhost:3001
- **PID**: Check with `ps aux | grep combined-dashboard`

## Key Findings

### CAPTCHA Behavior
- **Confirmed**: 1 CAPTCHA solve = 19 pages without CAPTCHA
- **Issue**: Running 5 parallel processes triggered immediate CAPTCHAs on every page
- **Solution**: Reduced to 3 parallel processes to avoid rate limiting

### Implementation Details
- All processes use the same `batch-employer-scraper.js` script
- Each process has unique browser profile directory
- Scrolling to contact section implemented on every page
- External URL filtering active (excludes jobs with externeurl field)

## Progress Tracking

### Database State
- **Initial employers with emails**: 26,645 (after import from our_sql_employment_agency)
- **Target**: Process 15,000 employers (3 batches × 5,000 each)

### Expected Performance
- ~20 pages per CAPTCHA solve
- ~3 seconds delay between employer requests
- Each process should handle ~300-400 employers per hour

## Commands

### Monitor Progress
```bash
# Watch real-time logs
tail -f logs/parallel-historical-scraper.log

# Check dashboard
open http://localhost:3001

# Count current emails
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM job_scrp_employers WHERE contact_emails IS NOT NULL AND contact_emails <> '';"
```

### Stop Processes
```bash
# Stop all scrapers
pkill -f batch-employer-scraper

# Stop dashboard
pkill -f combined-dashboard
```

### Restart if Needed
```bash
# Run 3 scrapers
node start-3-scrapers.js

# Start dashboard
node src/combined-dashboard.js > dashboard.log 2>&1 &
```

## Notes
- Batch files are preserved from previous run
- Each batch contains employers sorted by newest job posting date
- Process isolation prevents cookie/session sharing between browsers