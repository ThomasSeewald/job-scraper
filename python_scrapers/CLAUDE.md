# CLAUDE.md - Python Job Scraper System

This file provides guidance to Claude Code when working with the Python-based job scraper system in this repository.

## Status: Production Ready (January 2025)
The Python scrapers have replaced the Node.js scrapers as the primary scraping system due to superior performance and reliability.

## Overview

The Python scraper system uses Playwright for browser automation and provides:
- **Atomic employer claiming**: No duplicate processing between parallel workers
- **High performance**: Jobs processed in 2-3 seconds (vs 10-20 seconds previously)
- **Visual monitoring**: 4-window display for real-time progress tracking
- **Smart domain extraction**: Follows external URLs to capture employer domains
- **Persistent sessions**: Cookie and state management across scraping sessions

## Key Files

### Core Components
- `unified_scraper.py`: Main scraper class with atomic claiming logic
- `four_window_unified.py`: 4-window parallel scraper for visual monitoring
- `base_scraper.py`: Base class with cookie/CAPTCHA handling
- `config.py`: Configuration settings (database, CAPTCHA API, etc.)
- `email_extractor.py`: Email extraction and validation logic

### Test Scripts
- `test_visible_browser.py`: Test browser visibility
- `test_4_windows_split.py`: Test 4-window layout

## Architecture

### Atomic Employer Claiming
```sql
-- Single query that claims employer and returns job info
UPDATE job_scrp_employers 
SET email_extraction_date = NOW(),
    email_extraction_attempted = true
FROM available_jobs
WHERE job_scrp_employers.id = available_jobs.employer_id
RETURNING name, refnr, titel;
```

### Performance Optimizations
1. **No delays**: Removed all unnecessary waits between jobs
2. **Optimized queries**: Single atomic query vs multiple queries
3. **Conditional waits**: Only wait when cookies/CAPTCHA present
4. **External URL handling**: Async domain extraction

## Usage

### Single Worker
```bash
# Batch mode (process N jobs then stop)
python3 unified_scraper.py --batch-size 50 --delay 0

# Continuous mode
python3 unified_scraper.py --mode continuous --worker-id 0
```

### 4-Window Parallel Scraper
```bash
# Run in foreground
python3 four_window_unified.py

# Run in background
nohup python3 four_window_unified.py > scraper.log 2>&1 &
```

### Command Line Options
- `--worker-id`: Unique worker identifier (default: 0)
- `--mode`: 'batch' or 'continuous' (default: batch)
- `--batch-size`: Jobs per batch (default: 50)
- `--delay`: Seconds between jobs (default: 10, recommended: 0)
- `--headless`: Run without browser UI

## Key Features

### Cookie Persistence
- Cookies saved per worker in `cookies/unified-worker-{id}/`
- Automatic cookie acceptance on first run
- State persists across sessions

### CAPTCHA Handling
- Integrated 2captcha.com solver
- Automatic detection and solving
- Scrolls to contact section after solving

### External URL Processing
- Detects jobexport.de links
- Follows redirects to get actual employer domain
- Stores domain even when no emails found on page

### Visual Status Display
Each worker window shows:
- Worker ID and color
- Current employer being processed
- Success/failure status
- Found emails and domains
- Running statistics

## Database Schema

### Key Tables
- `job_scrp_employers`: Employer records with email_extraction_attempted flag
- `job_scrp_arbeitsagentur_jobs_v2`: Job listings
- `job_scrp_job_details`: Scraped contact information

### Important Columns
- `email_extraction_attempted`: Prevents duplicate processing
- `email_extraction_date`: Timestamp of extraction attempt
- `contact_emails`: Extracted email addresses
- `company_domain`: Extracted domain (from emails or external URLs)

## Performance Metrics

### Current Performance (January 2025)
- **Job processing time**: 2-3 seconds per job
- **Database query time**: <1 second (was 20-30 seconds)
- **Email extraction rate**: ~60% when available
- **CAPTCHA success rate**: >80%

### Processing Rate
- Single worker: ~20-30 jobs/minute
- 4 workers: ~80-120 jobs/minute

## Troubleshooting

### Common Issues
1. **"external_domain referenced before assignment"**: Fixed in latest version
2. **Slow job claiming**: Use optimized query with pre-selection
3. **Cookie errors**: Delete cookie directory to force re-acceptance

### Monitoring
```bash
# Check recent activity
tail -f four_window_optimized.log

# Count processed employers
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -c \
  "SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_date > NOW() - INTERVAL '1 hour';"
```

## Future Enhancements
- [ ] Add retry mechanism for failed CAPTCHA
- [ ] Implement smart employer prioritization
- [ ] Add webhook notifications for extracted emails
- [ ] Create dashboard for monitoring progress