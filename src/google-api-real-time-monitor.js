const fs = require('fs').promises;
const path = require('path');

/**
 * Google API Real-Time Quota Monitor
 * 
 * This module intercepts Google Custom Search API responses to extract
 * real-time quota information from headers and response body.
 * 
 * Google provides quota info in:
 * 1. Response Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * 2. Response Body: data.queries object contains request count info
 */

class GoogleAPIRealTimeMonitor {
    constructor() {
        this.quotaFilePath = path.join(__dirname, '../google-quota-state.json');
        this.defaultQuota = {
            daily_limit: 100,
            queries_used: 0,
            queries_remaining: 100,
            last_check: null,
            last_reset: null,
            rate_limit_info: {},
            history: []
        };
    }

    /**
     * Load saved quota state from file
     */
    async loadQuotaState() {
        try {
            const data = await fs.readFile(this.quotaFilePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // File doesn't exist, return default
            return this.defaultQuota;
        }
    }

    /**
     * Save quota state to file
     */
    async saveQuotaState(state) {
        try {
            await fs.writeFile(this.quotaFilePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('Error saving quota state:', error);
        }
    }

    /**
     * Extract quota information from Google API response
     */
    extractQuotaFromResponse(response, responseData) {
        const quotaInfo = {
            timestamp: new Date().toISOString(),
            headers: {},
            queries: {}
        };

        // Extract from headers (if available)
        if (response.headers) {
            quotaInfo.headers = {
                rateLimit: response.headers.get('X-RateLimit-Limit'),
                remaining: response.headers.get('X-RateLimit-Remaining'),
                reset: response.headers.get('X-RateLimit-Reset')
            };
        }

        // Extract from response body
        if (responseData && responseData.queries) {
            quotaInfo.queries = responseData.queries;
            
            // Google returns nextPage info which includes totalResults
            if (responseData.queries.request && responseData.queries.request[0]) {
                quotaInfo.queries.count = parseInt(responseData.queries.request[0].count) || 10;
                quotaInfo.queries.totalResults = parseInt(responseData.queries.request[0].totalResults) || 0;
            }
        }

        // Check for quota errors
        if (responseData && responseData.error) {
            quotaInfo.error = responseData.error;
            if (responseData.error.code === 429) {
                quotaInfo.quotaExceeded = true;
                quotaInfo.errorMessage = responseData.error.message;
            }
        }

        return quotaInfo;
    }

    /**
     * Update quota state based on API response
     */
    async updateQuotaFromResponse(response, responseData) {
        const currentState = await this.loadQuotaState();
        const quotaInfo = this.extractQuotaFromResponse(response, responseData);

        // Update state based on extracted info
        currentState.last_check = quotaInfo.timestamp;

        // Update rate limit info from headers
        if (quotaInfo.headers.remaining) {
            currentState.queries_remaining = parseInt(quotaInfo.headers.remaining);
            currentState.queries_used = currentState.daily_limit - currentState.queries_remaining;
        }

        if (quotaInfo.headers.reset) {
            currentState.last_reset = new Date(parseInt(quotaInfo.headers.reset) * 1000).toISOString();
        }

        // Store latest rate limit info
        currentState.rate_limit_info = quotaInfo.headers;

        // Add to history (keep last 10 checks)
        currentState.history.unshift(quotaInfo);
        if (currentState.history.length > 10) {
            currentState.history = currentState.history.slice(0, 10);
        }

        // Handle quota exceeded error
        if (quotaInfo.quotaExceeded) {
            currentState.queries_remaining = 0;
            currentState.queries_used = currentState.daily_limit;
            currentState.quota_exceeded = true;
            currentState.quota_exceeded_at = quotaInfo.timestamp;
        }

        await this.saveQuotaState(currentState);
        return currentState;
    }

    /**
     * Make a test API call to get current quota status
     */
    async checkQuotaWithTestCall(apiKey, searchEngineId) {
        try {
            const testQuery = 'test quota check';
            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(testQuery)}&num=1`;

            const response = await fetch(url);
            const data = await response.json();

            // Log all headers for debugging
            console.log('Response Headers:');
            for (const [key, value] of response.headers.entries()) {
                if (key.toLowerCase().includes('rate') || key.toLowerCase().includes('limit')) {
                    console.log(`${key}: ${value}`);
                }
            }

            // Update quota state
            const quotaState = await this.updateQuotaFromResponse(response, data);

            return {
                success: !data.error,
                quotaState: quotaState,
                apiResponse: data
            };

        } catch (error) {
            console.error('Error checking quota:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get current quota status without making an API call
     */
    async getCurrentQuotaStatus() {
        const state = await this.loadQuotaState();
        
        // Calculate if we're in a new day (quota should have reset)
        if (state.last_reset) {
            const lastReset = new Date(state.last_reset);
            const now = new Date();
            
            // If it's a new day, reset the counters
            if (now.toDateString() !== lastReset.toDateString()) {
                state.queries_used = 0;
                state.queries_remaining = state.daily_limit;
                state.quota_exceeded = false;
                await this.saveQuotaState(state);
            }
        }

        return {
            ...state,
            usage_percentage: Math.round((state.queries_used / state.daily_limit) * 100),
            is_warning: state.queries_used >= 80,
            is_exceeded: state.queries_used >= state.daily_limit,
            can_continue: state.queries_remaining > 0
        };
    }

    /**
     * Create a middleware for Express to monitor Google API calls
     */
    createMonitoringMiddleware() {
        return async (req, res, next) => {
            // Store original json method
            const originalJson = res.json.bind(res);

            // Override json method to intercept responses
            res.json = async (data) => {
                // Check if this is a Google API proxy response
                if (req.path === '/google_search' && data.results) {
                    // Simulate quota tracking (increment usage)
                    const state = await this.loadQuotaState();
                    state.queries_used += 1;
                    state.queries_remaining = Math.max(0, state.daily_limit - state.queries_used);
                    state.last_check = new Date().toISOString();
                    await this.saveQuotaState(state);
                }

                // Call original json method
                return originalJson(data);
            };

            next();
        };
    }
}

// CLI execution for testing
if (require.main === module) {
    const monitor = new GoogleAPIRealTimeMonitor();
    
    (async () => {
        console.log('🔍 Google API Real-Time Quota Monitor');
        console.log('=====================================\n');

        // Check if we have API credentials
        const apiKey = 'AIzaSyBUv0IUn7f4OEfzPF8mqcdHf3X8ubcI7MU';
        const searchEngineId = '24f407b14f2344198';

        if (process.argv[2] === 'test') {
            console.log('Making test API call to check quota...\n');
            const result = await monitor.checkQuotaWithTestCall(apiKey, searchEngineId);
            
            if (result.success) {
                console.log('✅ Quota check successful!\n');
                console.log('Current State:', JSON.stringify(result.quotaState, null, 2));
            } else {
                console.log('❌ Quota check failed:', result.error);
            }
        } else {
            // Just show current status
            const status = await monitor.getCurrentQuotaStatus();
            console.log('Current Quota Status:');
            console.log('====================');
            console.log(`Queries Used: ${status.queries_used}/${status.daily_limit}`);
            console.log(`Remaining: ${status.queries_remaining}`);
            console.log(`Usage: ${status.usage_percentage}%`);
            console.log(`Last Check: ${status.last_check || 'Never'}`);
            console.log(`Status: ${status.is_exceeded ? '❌ Quota Exceeded' : status.is_warning ? '⚠️ Warning' : '✅ OK'}`);
            
            if (status.history && status.history.length > 0) {
                console.log('\nRecent API Calls:');
                status.history.slice(0, 5).forEach((call, i) => {
                    console.log(`${i + 1}. ${call.timestamp} - ${call.error ? '❌ Error' : '✅ Success'}`);
                });
            }
        }
    })();
}

module.exports = GoogleAPIRealTimeMonitor;