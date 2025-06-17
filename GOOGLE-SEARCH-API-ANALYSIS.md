# Google Search API Analysis

## Overview

The Large Tables project uses **Google Custom Search API v1** for web search functionality. Here's what I found:

### 1. **API Configuration**
Located in: `/Users/thomassee/Docker/containers/largeTables/mnt/extra-addons/_our_my_sql/controllers/custom_search_api.py`

```python
api_key = 'AIzaSyBUv0IUn7f4OEfzPF8mqcdHf3X8ubcI7MU'
search_engine_id = '24f407b14f2344198'
url = 'https://www.googleapis.com/customsearch/v1'
```

### 2. **Current Implementation**

#### **Endpoints**
- `/google_search` - Direct Google search endpoint
- `/call_custom_search_api/my_sql_employment_agency` - Employment agency search
- `/call_custom_search_api/yellow_pages` - Yellow pages search

#### **Functionality**
- Performs Google searches via Custom Search API
- Returns list of URLs from search results
- Integrated with Odoo models for storing results
- Used for finding employer websites and contact information

### 3. **Google Custom Search API Quotas**

#### **Default Limits**
- **Free Tier**: 100 queries per day
- **Paid Tier**: $5 per 1,000 queries (after free quota)
- **Rate Limit**: 10 queries per second per user

#### **Important**: No Direct Balance/Quota API
Google Custom Search API does **NOT** provide a direct endpoint to check remaining quota or balance. Unlike 2captcha which has a balance endpoint, Google tracks usage differently.

### 4. **Monitoring Google API Usage**

#### **Option 1: Google Cloud Console**
- Visit: https://console.cloud.google.com/apis/api/customsearch.googleapis.com
- View usage graphs and quota consumption
- Set up alerts for quota limits

#### **Option 2: Implement Local Tracking**
We could add a local counter to track API usage:

```python
# Add to database
class GoogleAPIUsage(models.Model):
    _name = 'google.api.usage'
    
    date = fields.Date(default=fields.Date.today)
    query_count = fields.Integer(default=0)
    last_query_time = fields.Datetime()
    
    def increment_usage(self):
        today = fields.Date.today()
        usage = self.search([('date', '=', today)], limit=1)
        if usage:
            usage.query_count += 1
            usage.last_query_time = fields.Datetime.now()
        else:
            self.create({
                'date': today,
                'query_count': 1,
                'last_query_time': fields.Datetime.now()
            })
```

#### **Option 3: Parse API Response Headers**
Google includes rate limit information in response headers:
- `X-RateLimit-Limit`: Your rate limit
- `X-RateLimit-Remaining`: Calls remaining
- `X-RateLimit-Reset`: When the limit resets

### 5. **Integration with Job Scraper Dashboard**

Since Google API doesn't provide a balance endpoint like 2captcha, we have these options:

#### **A. Track Local Usage**
```javascript
// Add to dashboard
const googleUsageQuery = `
    SELECT 
        COUNT(*) as queries_today,
        100 - COUNT(*) as remaining_quota
    FROM our_google_search
    WHERE DATE(create_date) = CURRENT_DATE
`;
```

#### **B. Monitor API Errors**
The API returns specific errors when quota is exceeded:
```json
{
    "error": {
        "code": 429,
        "message": "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'",
        "status": "RESOURCE_EXHAUSTED"
    }
}
```

#### **C. Add Usage Tracking to Dashboard**
We could add a Google API usage monitor similar to the 2captcha balance:

```javascript
// In combined-dashboard.js
app.get('/api/google-usage', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            const usageQuery = `
                SELECT 
                    COUNT(*) as queries_today,
                    MAX(created_at) as last_query
                FROM google_search_logs
                WHERE DATE(created_at) = CURRENT_DATE
            `;
            const result = await client.query(usageQuery);
            
            res.json({
                success: true,
                usage: result.rows[0].queries_today || 0,
                remaining: 100 - (result.rows[0].queries_today || 0),
                lastQuery: result.rows[0].last_query
            });
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

### 6. **Recommendations**

1. **Create Usage Tracking Table**: Since Google doesn't provide a balance API, implement local tracking
2. **Add Dashboard Widget**: Show daily Google API usage alongside 2captcha balance
3. **Set Up Alerts**: Warn when approaching daily limit (e.g., at 80 queries)
4. **Consider Caching**: Cache search results to reduce API calls
5. **Monitor Errors**: Track 429 errors to detect quota exhaustion

### 7. **Alternative: SerpAPI Integration**

I also noticed the code imports `serpapi`:
```python
from serpapi import GoogleSearch
api_key = "57b89b258c045b13882bea02a86123762ffed017b3b2e532b64f39c46c363e1d"
```

SerpAPI is a third-party service that provides:
- More generous quotas
- Built-in proxy rotation
- No rate limits
- Better pricing for high volume

**Note**: SerpAPI DOES have a balance/credit system that can be checked via their API.