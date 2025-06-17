# Google Domains Service

A centralized API service for discovering and verifying employer domains across all projects.

## Features

- **Fuzzy Company Name Matching**: Handles variations like "GmbH" vs "G.m.b.H."
- **Google Custom Search Integration**: Uses the existing API keys from Odoo
- **Address-based Verification**: Uses libpostal to verify addresses in impressum pages
- **Email Extraction**: Finds emails on impressum, kontakt, karriere, and jobs pages
- **Multi-Project Support**: Accessible by job scraper, yellow pages, and other projects
- **Caching**: Reuses verified domains to reduce API calls

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Job Scraper   │     │  Yellow Pages   │     │  Other Projects │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                         │
         └───────────────────────┼─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Google Domains Client  │
                    └────────────┬────────────┘
                                 │ HTTP
                    ┌────────────▼────────────┐
                    │  Google Domains API     │
                    │    (Port 5000)          │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
     ┌──────────▼──────┐ ┌───────▼──────┐ ┌──────▼───────┐
     │ Company Name    │ │   Google     │ │   Domain     │
     │   Matcher       │ │   Search     │ │  Verifier    │
     └─────────────────┘ └──────────────┘ └──────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   PostgreSQL Database   │
                    │  google_domains_service │
                    └─────────────────────────┘
```

## Installation

### 1. Install Dependencies

```bash
pip install -r requirements-google-domains.txt
```

### 2. Install libpostal (Optional but Recommended)

```bash
# On Ubuntu/Debian
sudo apt-get install libpostal-dev

# On macOS
brew install libpostal

# Install Python bindings
pip install postal
```

### 3. Create Database

```bash
# Run the SQL script to create tables
psql -h localhost -p 5473 -U odoo -d jetzt -f create-google-domains-service.sql
```

### 4. Start the API Service

```bash
# Run directly
python3 google_domains_api.py

# Or install as a systemd service (Linux)
sudo cp google-domains-api.service /etc/systemd/system/
sudo systemctl enable google-domains-api
sudo systemctl start google-domains-api
```

## Usage

### From Job Scraper

```python
from google_domains_client import GoogleDomainsClient

# Initialize client
client = GoogleDomainsClient(source_system="job_scraper")

# Search for employer domain
result = client.search_domain(
    company_name="Mercedes-Benz GmbH",
    street="Hauptstraße 1",
    postal_code="70327"
)

if result['status'] == 'cached':
    print(f"Found cached domain: {result['domain']}")
    print(f"Emails: {result['emails']}")
elif result['status'] == 'new_search':
    print(f"New domain found: {result['domain']}")
```

### From Yellow Pages

```python
from google_domains_client import search_employer_domain

# Quick one-off search
result = search_employer_domain(
    company_name="Siemens AG",
    postal_code="80333",
    city="München",
    source="yellow_pages"
)
```

### Integration with Existing Scrapers

Modify your scraper to check Google domains first:

```python
# In unified_scraper.py
from google_domains_client import GoogleDomainsClient

class UnifiedScraper:
    def __init__(self):
        self.google_client = GoogleDomainsClient(source_system="job_scraper")
    
    async def process_job(self, employer_name, refnr, job_title):
        # First check Google domains cache
        google_result = self.google_client.search_domain(
            company_name=employer_name,
            postal_code=self.get_job_postal_code(refnr)
        )
        
        if google_result.get('domain') and google_result.get('emails'):
            # Skip Arbeitsagentur scraping, we have the data
            return {
                'success': True,
                'emails': google_result['emails'],
                'domain': google_result['domain'],
                'source': 'google_domains_cache'
            }
        
        # Continue with normal Arbeitsagentur scraping...
```

## API Endpoints

### POST /api/search
Search for employer domain

```json
{
    "company_name": "Example GmbH",
    "street": "Main Street 123",
    "postal_code": "12345",
    "city": "Berlin",
    "source": "job_scraper"
}
```

### POST /api/verify
Verify if a domain belongs to a company

```json
{
    "domain": "example.com",
    "company_name": "Example GmbH",
    "postal_code": "12345",
    "source": "yellow_pages"
}
```

### POST /api/extract-emails
Extract emails from a domain

```json
{
    "domain": "example.com",
    "pages": ["impressum", "kontakt", "karriere"],
    "source": "manual"
}
```

### GET /api/similar
Find similar companies

```
/api/similar?company=Example%20GmbH&postal_code=12345&threshold=0.7
```

### GET /api/stats
Get service statistics

## Database Schema

The service uses a single unified table `google_domains_service` with:

- Fuzzy matching using PostgreSQL pg_trgm extension
- Normalized company names for better matching
- Address verification scores
- Email storage by page type
- Usage tracking for all systems

## Configuration

API keys and settings are stored in the `google_domains_config` table:

```sql
SELECT * FROM google_domains_config;
```

## Monitoring

Check service health:

```bash
curl http://localhost:5000/api/health
```

View usage statistics:

```bash
curl http://localhost:5000/api/stats
```

## Performance

- Fuzzy matching queries: <100ms
- Google API searches: 1-2 seconds
- Domain verification: 2-5 seconds
- Email extraction: 3-10 seconds per domain

## Security

- API keys stored in database (not in code)
- Source system tracking for access control
- Rate limiting can be added if needed
- CORS enabled for cross-project access

## Troubleshooting

### Service won't start
- Check PostgreSQL connection
- Verify port 5000 is available
- Check logs: `journalctl -u google-domains-api`

### No impressum found
- Some sites hide impressum behind JavaScript
- Try manual verification for important domains

### Fuzzy matching not working
- Ensure pg_trgm extension is installed
- Check normalized company names in database

## Future Enhancements

- [ ] Add caching layer (Redis)
- [ ] Implement rate limiting
- [ ] Add webhook notifications
- [ ] Support more languages
- [ ] Machine learning for better matching