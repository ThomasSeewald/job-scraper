# Employer Domains System

A unified system for discovering and tracking employer domains based on their addresses.

## Overview

This system consolidates employer domain discovery from multiple sources:
- Existing Odoo data (`our_google_domains`, `our_domains` tables)
- Job scraper employers 
- Future Google searches based on employer addresses

## Quick Start

### 1. Create Database Views

```bash
cd dashboard
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -f create-employer-coverage-views.sql
```

### 2. Migrate Existing Data

```bash
cd python_scrapers
./run-migration.sh
```

This will:
- Migrate 31,515 Google search results from `our_google_domains`
- Migrate 234,306 domain records from `our_domains`
- Preserve all email data (148,354 domains with emails)

### 3. Start the Dashboard

```bash
cd dashboard
npm start
```

Then visit: http://localhost:3001/employer-domains

### 4. (Optional) Start Google Domains API

```bash
cd python_scrapers
python3 google_domains_api.py
```

The API runs on port 5000 and provides:
- `/api/search` - Search for employer domains
- `/api/verify` - Verify domain ownership
- `/api/extract-emails` - Extract emails from domains

## Dashboard Features

### Coverage Overview
- Total employers in system
- Percentage with Google searches
- Percentage with verified domains
- Percentage with extracted emails

### Priority Queue
Shows employers that need domain discovery, prioritized by:
1. **P1**: 10+ active jobs, no domain
2. **P2**: 5+ active jobs, no Google search
3. **P3**: Recent jobs (< 30 days), no domain
4. **P4**: Any jobs, no search
5. **P5**: Low priority

### Regional Analysis
Coverage breakdown by PLZ (postal code) regions showing:
- Total employers per region
- Search coverage percentage
- Active job counts

### Recent Activity
- Search activity by day
- Successful domain discoveries
- Email extraction successes

## Database Schema

### Main Tables

1. **google_domains_service** (New unified table)
   - Stores all Google search results
   - Tracks domain verification
   - Contains extracted emails by page type
   - Uses fuzzy matching for company names

2. **employer_domain_coverage** (View)
   - Combines data from all sources
   - Shows current coverage status
   - Calculates priority scores

3. **employer_search_queue** (View)
   - Prioritized list of employers needing searches
   - Includes address and job information

## How It Works

1. **Address-Based Matching**
   - Uses employer addresses from job listings
   - Searches Google with: `"Company Street 'PLZ'"`
   - Verifies domains by checking impressum pages

2. **Fuzzy Company Matching**
   - Handles variations (GmbH vs G.m.b.H.)
   - Uses PostgreSQL pg_trgm for similarity
   - 70% similarity threshold for matches

3. **Email Extraction**
   - Checks multiple pages: impressum, kontakt, karriere, jobs
   - Handles obfuscation: [at], [dot], etc.
   - Stores emails by source page

## Current Status

After migration:
- **188,898** total employers
- **14,323** searched via Google (7.6%)
- **234,306** verified domains
- **148,354** with emails
- **174,575** pending search (92.4%)

## Next Steps

1. **Process High-Priority Queue**
   - Export priority employers
   - Run Google searches via API
   - Import results

2. **Integrate with Scrapers**
   - Modify unified_scraper.py to check cache first
   - Skip Arbeitsagentur for known domains
   - Track source of discoveries

3. **Monitor Progress**
   - Check dashboard daily
   - Track success rates
   - Identify problem patterns

## API Integration

To use in other projects:

```python
from google_domains_client import GoogleDomainsClient

client = GoogleDomainsClient(source_system="my_project")
result = client.search_domain(
    company_name="Example GmbH",
    postal_code="12345"
)

if result['domain']:
    emails = client.extract_emails(result['domain'])
```

## Troubleshooting

### Migration Issues
- Ensure pg_trgm extension is installed
- Check for duplicate company names
- Verify postal code formats

### Performance
- Create indexes as specified in SQL
- Use batch operations for bulk searches
- Monitor query performance

### Data Quality
- Review employers with no addresses
- Check for outdated employer data
- Validate email formats

## Future Enhancements

1. **Automated Processing**
   - Background job for queue processing
   - Real-time Google search integration
   - Webhook notifications

2. **Quality Improvements**
   - Machine learning for better matching
   - Advanced address parsing
   - Domain reputation scoring

3. **Integration**
   - Direct scraper integration
   - Yellow pages connection
   - Export to CRM systems