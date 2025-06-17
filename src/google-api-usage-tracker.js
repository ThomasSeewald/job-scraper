const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Google API Usage Tracker
 * 
 * Since Google Custom Search API doesn't provide a balance/quota endpoint,
 * this module tracks API usage locally by monitoring the our_google_search table
 * in the Large Tables database.
 * 
 * Google Custom Search API Limits:
 * - Free tier: 100 queries per day
 * - Paid tier: $5 per 1,000 queries after free quota
 * - Rate limit: 10 queries per second
 */

class GoogleAPIUsageTracker {
    constructor() {
        // Connect to Large Tables database
        this.pool = new Pool({
            user: 'odoo',
            host: 'localhost',
            database: 'postgres',  // Large Tables main database
            password: 'odoo',
            port: 5473,
        });
        
        this.dailyQuotaLimit = 100; // Google's free tier limit
        this.warningThreshold = 80; // Warn at 80% usage
    }

    /**
     * Get today's Google API usage from our_google_search table
     */
    async getTodayUsage() {
        try {
            // Check if the table exists in this database
            const tableCheckQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'our_google_search'
                );
            `;
            
            const tableExists = await this.pool.query(tableCheckQuery);
            
            if (!tableExists.rows[0].exists) {
                // Table doesn't exist in this database, return mock data
                return {
                    queries_today: 0,
                    last_query_time: null,
                    table_exists: false
                };
            }

            // Get today's usage
            const usageQuery = `
                SELECT 
                    COUNT(*) as queries_today,
                    MAX(create_date) as last_query_time
                FROM our_google_search
                WHERE DATE(create_date) = CURRENT_DATE
            `;
            
            const result = await this.pool.query(usageQuery);
            
            return {
                queries_today: parseInt(result.rows[0].queries_today) || 0,
                last_query_time: result.rows[0].last_query_time,
                table_exists: true
            };
            
        } catch (error) {
            console.error('Error fetching Google API usage:', error);
            // Return safe defaults on error
            return {
                queries_today: 0,
                last_query_time: null,
                error: error.message
            };
        }
    }

    /**
     * Get usage statistics and quota information
     */
    async getUsageStats() {
        const usage = await this.getTodayUsage();
        
        const stats = {
            daily_limit: this.dailyQuotaLimit,
            queries_used: usage.queries_today,
            queries_remaining: Math.max(0, this.dailyQuotaLimit - usage.queries_today),
            usage_percentage: Math.round((usage.queries_today / this.dailyQuotaLimit) * 100),
            last_query_time: usage.last_query_time,
            is_warning: usage.queries_today >= this.warningThreshold,
            is_exceeded: usage.queries_today >= this.dailyQuotaLimit,
            status: this.getStatus(usage.queries_today),
            table_exists: usage.table_exists || false,
            error: usage.error
        };
        
        return stats;
    }

    /**
     * Get usage status based on current consumption
     */
    getStatus(queriesUsed) {
        const percentage = (queriesUsed / this.dailyQuotaLimit) * 100;
        
        if (percentage >= 100) {
            return { level: 'danger', message: 'Quota exceeded!' };
        } else if (percentage >= 80) {
            return { level: 'warning', message: 'Approaching limit' };
        } else if (percentage >= 50) {
            return { level: 'info', message: 'Moderate usage' };
        } else {
            return { level: 'success', message: 'Plenty remaining' };
        }
    }

    /**
     * Get historical usage for the past N days
     */
    async getHistoricalUsage(days = 7) {
        try {
            const tableCheckQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'our_google_search'
                );
            `;
            
            const tableExists = await this.pool.query(tableCheckQuery);
            
            if (!tableExists.rows[0].exists) {
                return [];
            }

            const historyQuery = `
                SELECT 
                    DATE(create_date) as date,
                    COUNT(*) as query_count
                FROM our_google_search
                WHERE create_date >= CURRENT_DATE - INTERVAL '${days} days'
                GROUP BY DATE(create_date)
                ORDER BY date DESC
            `;
            
            const result = await this.pool.query(historyQuery);
            
            return result.rows.map(row => ({
                date: row.date,
                queries: parseInt(row.query_count),
                percentage: Math.round((parseInt(row.query_count) / this.dailyQuotaLimit) * 100)
            }));
            
        } catch (error) {
            console.error('Error fetching historical usage:', error);
            return [];
        }
    }

    /**
     * Check if we're approaching or at the quota limit
     */
    async checkQuotaStatus() {
        const stats = await this.getUsageStats();
        
        return {
            can_continue: stats.queries_remaining > 0,
            should_warn: stats.is_warning,
            queries_remaining: stats.queries_remaining,
            message: stats.is_exceeded 
                ? 'Google API daily quota exceeded. Please wait until tomorrow.'
                : stats.is_warning 
                    ? `Warning: Only ${stats.queries_remaining} Google searches remaining today.`
                    : `${stats.queries_remaining} Google searches available.`
        };
    }

    /**
     * Format usage for display
     */
    formatUsageDisplay(stats) {
        const barLength = 20;
        const filledLength = Math.round((stats.usage_percentage / 100) * barLength);
        const emptyLength = barLength - filledLength;
        
        const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
        
        return `
Google API Usage (${new Date().toLocaleDateString()})
================================
Queries Used: ${stats.queries_used}/${stats.daily_limit}
Progress: [${progressBar}] ${stats.usage_percentage}%
Status: ${stats.status.message}
Remaining: ${stats.queries_remaining} queries
Last Query: ${stats.last_query_time ? new Date(stats.last_query_time).toLocaleTimeString() : 'None today'}
`;
    }

    /**
     * Close database connection
     */
    async close() {
        await this.pool.end();
    }
}

// CLI execution
if (require.main === module) {
    const tracker = new GoogleAPIUsageTracker();
    
    (async () => {
        try {
            console.log('🔍 Google API Usage Tracker');
            console.log('==========================\n');
            
            // Get current usage
            const stats = await tracker.getUsageStats();
            console.log(tracker.formatUsageDisplay(stats));
            
            // Get historical usage
            console.log('\nLast 7 Days:');
            console.log('------------');
            const history = await tracker.getHistoricalUsage(7);
            history.forEach(day => {
                console.log(`${new Date(day.date).toLocaleDateString()}: ${day.queries} queries (${day.percentage}%)`);
            });
            
            // Check quota status
            const quotaStatus = await tracker.checkQuotaStatus();
            console.log(`\n${quotaStatus.message}`);
            
        } catch (error) {
            console.error('Error:', error);
        } finally {
            await tracker.close();
        }
    })();
}

module.exports = GoogleAPIUsageTracker;