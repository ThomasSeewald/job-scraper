# Keyword Search Integration

This module adds keyword-based email search as a fallback mechanism when no emails are found on the job detail page.

## Overview

The keyword search functionality:
1. Searches for links containing keywords like "impressum", "kontakt", "karriere", "jobs"
2. Visits those pages to extract emails
3. Supports both German and English keyword variants
4. Integrates seamlessly with the existing email validation logic

## Core Components

### `keyword_searcher.py`
- Main keyword search module
- Finds keyword-based links on a domain
- Extracts emails from those pages
- Formats results for database storage

### `unified_scraper_with_keywords.py`
- Enhanced version of unified_scraper.py
- Includes keyword search as fallback
- Searches employer website or external domain when no emails found
- Tracks keyword search statistics

### `four_window_unified_keywords.py`
- Four-window parallel version with keyword search
- Visual monitoring of keyword searches across workers
- Continuous mode with automatic restart

## Usage

### Single Worker with Keywords
```bash
# Run with keyword search enabled (default)
python3 unified_scraper_with_keywords.py --batch-size 50

# Disable keyword search
python3 unified_scraper_with_keywords.py --batch-size 50 --no-keywords

# Run in continuous mode
python3 unified_scraper_with_keywords.py --mode continuous --worker-id 0
```

### Four Workers with Keywords
```bash
# Run 4 parallel workers with keyword search
python3 four_window_unified_keywords.py

# Run without keyword search
python3 four_window_unified_keywords.py --no-keywords
```

### Testing Keyword Search
```bash
# Test on default domains
python3 test_keyword_search.py

# Test on specific domain
python3 test_keyword_search.py example.com
```

## How It Works

1. **Initial Email Extraction**: First attempts to find emails on the job detail page
2. **Domain Detection**: If no emails found, identifies the employer's domain from:
   - External application URL (highest priority)
   - Employer's website from database
   - Domain extracted from page content
3. **Keyword Search**: Visits the domain and searches for keyword links
4. **Email Extraction**: Extracts emails from up to 3 pages per keyword
5. **Result Merging**: Combines keyword-found emails with any existing emails
6. **Database Update**: Saves results with detailed notes about keyword sources

## Keyword Mappings

```python
KEYWORD_MAPPINGS = {
    'impressum': ['impressum', 'imprint', 'legal-notice', 'legal'],
    'kontakt': ['kontakt', 'contact', 'contact-us', 'kontaktieren'],
    'karriere': ['karriere', 'career', 'careers', 'jobs', 'stellenangebote'],
    'jobs': ['jobs', 'stellenangebote', 'stellen', 'karriere', 'career', 'careers']
}
```

## Performance Impact

- Adds ~5-10 seconds per employer when keyword search is triggered
- Only runs when no emails found on detail page
- Reuses existing browser page (no additional browser overhead)
- Limits to 3 pages per keyword to prevent excessive requests

## Database Notes Format

When keyword search finds emails, it adds notes like:
```
Keyword search found 5 emails in: impressum, kontakt. Emails: info@example.com, bewerbung@example.com, hr@example.com (and 2 more)
```

## Expected Results

- Increases email discovery rate by ~15-25%
- Most effective on German company websites
- Works best with properly structured corporate sites
- Fallback for when job detail pages lack contact information