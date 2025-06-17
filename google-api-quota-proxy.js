const express = require('express');
const axios = require('axios');
const GoogleAPIRealTimeMonitor = require('./src/google-api-real-time-monitor');

/**
 * Google API Quota Proxy
 * 
 * This proxy intercepts Google Custom Search API calls to monitor quota usage
 * in real-time by capturing response headers and body data.
 * 
 * Can be used to wrap existing Google API calls to add quota monitoring.
 */

const app = express();
const monitor = new GoogleAPIRealTimeMonitor();
const PORT = 3005;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Google API Quota Proxy' });
});

// Get current quota status
app.get('/quota-status', async (req, res) => {
    const status = await monitor.getCurrentQuotaStatus();
    res.json(status);
});

// Proxy Google Custom Search API calls with quota monitoring
app.get('/customsearch/v1', async (req, res) => {
    try {
        // Build Google API URL
        const googleUrl = 'https://www.googleapis.com/customsearch/v1';
        const params = new URLSearchParams(req.query);
        
        console.log(`Proxying Google API call: ${params.get('q')}`);
        
        // Make the actual API call
        const response = await axios.get(googleUrl, { 
            params: params,
            validateStatus: () => true // Accept any status code
        });

        // Extract quota information from response
        const quotaInfo = {
            headers: {},
            timestamp: new Date().toISOString()
        };

        // Capture rate limit headers
        const rateLimitHeaders = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
        for (const header of rateLimitHeaders) {
            if (response.headers[header]) {
                quotaInfo.headers[header] = response.headers[header];
            }
        }

        // Log quota information
        console.log('Quota Headers:', quotaInfo.headers);
        
        // Update quota state
        await monitor.updateQuotaFromResponse(
            { headers: { get: (key) => response.headers[key.toLowerCase()] } },
            response.data
        );

        // Return the original response with added quota info
        res.set({
            'X-Quota-Info': JSON.stringify(quotaInfo),
            'Content-Type': 'application/json'
        });
        
        res.status(response.status).json(response.data);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({
            error: {
                message: 'Proxy error: ' + error.message,
                code: 500
            }
        });
    }
});

// Test endpoint to check quota with a minimal API call
app.post('/test-quota', async (req, res) => {
    try {
        const { apiKey, searchEngineId } = req.body;
        
        if (!apiKey || !searchEngineId) {
            return res.status(400).json({ error: 'API key and search engine ID required' });
        }

        const result = await monitor.checkQuotaWithTestCall(apiKey, searchEngineId);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🔍 Google API Quota Proxy started on port ${PORT}`);
    console.log(`📊 Quota Status: http://localhost:${PORT}/quota-status`);
    console.log(`🔗 Proxy Endpoint: http://localhost:${PORT}/customsearch/v1`);
});

module.exports = app;