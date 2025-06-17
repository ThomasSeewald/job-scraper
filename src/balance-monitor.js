const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

class BalanceMonitor {
    constructor() {
        this.captchaSolver = new IndependentCaptchaSolver();
        this.alertThreshold = parseFloat(process.env.BALANCE_ALERT_THRESHOLD) || 5.0;
        this.emailRecipient = process.env.ALERT_EMAIL || 'thomas.seewald@gmail.com';
        this.stateFile = path.join(__dirname, '../balance-state.json');
        this.lastAlertFile = path.join(__dirname, '../last-alert.json');
        
        // Email configuration (IONOS - from Odoo settings)
        this.emailConfig = {
            host: process.env.SMTP_HOST || 'smtp.ionos.de',
            port: parseInt(process.env.SMTP_PORT) || 25,
            secure: false, // false for STARTTLS
            requireTLS: true,
            auth: {
                user: process.env.SMTP_USER || 'lernen@learnandearn.me',
                pass: process.env.SMTP_PASS || 'Zypern2023zz'
            }
        };
        
        console.log('📊 Balance Monitor initialized');
        console.log(`💰 Alert threshold: $${this.alertThreshold}`);
        console.log(`📧 Alert email: ${this.emailRecipient}`);
    }

    /**
     * Check current 2captcha balance and send alerts if needed
     * @returns {Promise<Object>} - Balance check result
     */
    async checkBalance() {
        const timestamp = new Date().toISOString();
        
        try {
            console.log('💰 Checking 2captcha balance...');
            
            const balanceResult = await this.captchaSolver.getBalance();
            
            if (!balanceResult.success) {
                console.error('❌ Failed to get balance:', balanceResult.error);
                return {
                    success: false,
                    error: balanceResult.error,
                    timestamp
                };
            }
            
            const currentBalance = parseFloat(balanceResult.balance);
            console.log(`💰 Current balance: $${currentBalance}`);
            
            // Save current state
            const state = {
                balance: currentBalance,
                timestamp,
                threshold: this.alertThreshold,
                belowThreshold: currentBalance < this.alertThreshold
            };
            
            await this.saveState(state);
            
            // Check if we need to send an alert
            if (currentBalance < this.alertThreshold) {
                console.log(`⚠️  Balance below threshold! ($${currentBalance} < $${this.alertThreshold})`);
                
                const shouldSendAlert = await this.shouldSendAlert(currentBalance);
                if (shouldSendAlert) {
                    const emailResult = await this.sendBalanceAlert(currentBalance);
                    state.alertSent = emailResult.success;
                    state.alertError = emailResult.error || null;
                    
                    if (emailResult.success) {
                        await this.recordAlertSent(currentBalance);
                    }
                }
            } else {
                console.log('✅ Balance is sufficient');
            }
            
            return {
                success: true,
                balance: currentBalance,
                belowThreshold: currentBalance < this.alertThreshold,
                alertSent: state.alertSent || false,
                timestamp
            };
            
        } catch (error) {
            console.error('❌ Balance check failed:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp
            };
        }
    }

    /**
     * Send balance alert email
     * @param {number} currentBalance - Current account balance
     * @returns {Promise<Object>} - Email sending result
     */
    async sendBalanceAlert(currentBalance) {
        try {
            console.log('📧 Sending balance alert email...');
            
            // Create transporter
            const transporter = nodemailer.createTransport(this.emailConfig);
            
            // Verify transporter
            try {
                await transporter.verify();
                console.log('✅ Email server connection verified');
            } catch (verifyError) {
                console.error('❌ Email server verification failed:', verifyError.message);
                console.log('🔧 Attempting to send email anyway (some servers don\'t support verify)...');
                // Continue anyway as some SMTP servers don't support verify
            }
            
            // Get system stats for email context
            const stats = await this.getSystemStats();
            
            const emailSubject = `🚨 2Captcha Balance Alert - $${currentBalance} remaining`;
            const emailBody = this.generateEmailBody(currentBalance, stats);
            
            const mailOptions = {
                from: 'lernen@learnandearn.me',
                to: this.emailRecipient,
                subject: emailSubject,
                html: emailBody,
                text: this.generatePlainTextEmail(currentBalance, stats)
            };
            
            const result = await transporter.sendMail(mailOptions);
            console.log('✅ Balance alert email sent successfully');
            console.log(`📧 Message ID: ${result.messageId}`);
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: this.emailRecipient,
                balance: currentBalance
            };
            
        } catch (error) {
            console.error('❌ Failed to send balance alert email:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate HTML email body
     * @param {number} balance - Current balance
     * @param {Object} stats - System statistics
     * @returns {string} - HTML email content
     */
    generateEmailBody(balance, stats) {
        const isUrgent = balance < 1.0;
        const urgencyColor = isUrgent ? '#dc3545' : '#ffc107';
        const urgencyText = isUrgent ? 'URGENT' : 'WARNING';
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
                .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header { background-color: ${urgencyColor}; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .alert-box { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 15px; margin: 15px 0; }
                .stats-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                .stats-table th, .stats-table td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
                .stats-table th { background-color: #f8f9fa; font-weight: bold; }
                .action-button { background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 10px 0; }
                .footer { background-color: #f8f9fa; padding: 15px; font-size: 12px; color: #6c757d; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🚨 ${urgencyText}: 2Captcha Balance Alert</h1>
                    <h2>$${balance} remaining</h2>
                </div>
                
                <div class="content">
                    <div class="alert-box">
                        <strong>⚠️ Action Required:</strong> Your 2Captcha account balance has dropped below the alert threshold of $${this.alertThreshold}.
                        ${isUrgent ? '<br><strong>URGENT:</strong> Balance is critically low! Service may be interrupted.' : ''}
                    </div>
                    
                    <h3>📊 Account Information</h3>
                    <table class="stats-table">
                        <tr><th>Current Balance</th><td>$${balance}</td></tr>
                        <tr><th>Alert Threshold</th><td>$${this.alertThreshold}</td></tr>
                        <tr><th>Status</th><td style="color: ${urgencyColor}; font-weight: bold;">${urgencyText}</td></tr>
                        <tr><th>Check Time</th><td>${new Date().toLocaleString()}</td></tr>
                    </table>
                    
                    <h3>🔧 System Statistics</h3>
                    <table class="stats-table">
                        <tr><th>API Key</th><td>${stats.apiKey}</td></tr>
                        <tr><th>Total Jobs Scraped</th><td>${stats.totalJobs || 'N/A'}</td></tr>
                        <tr><th>Jobs Today</th><td>${stats.jobsToday || 'N/A'}</td></tr>
                        <tr><th>Last Scraping</th><td>${stats.lastScraping || 'N/A'}</td></tr>
                        <tr><th>System Status</th><td>${stats.systemStatus || 'Unknown'}</td></tr>
                    </table>
                    
                    <h3>🚀 Recommended Actions</h3>
                    <ol>
                        <li><strong>Add Funds:</strong> Visit your 2Captcha dashboard to add credit</li>
                        <li><strong>Monitor Usage:</strong> Check CAPTCHA solving frequency in logs</li>
                        <li><strong>Optimize Scraping:</strong> Consider reducing scraping frequency if needed</li>
                        ${isUrgent ? '<li><strong>URGENT:</strong> Add funds immediately to prevent service interruption</li>' : ''}
                    </ol>
                    
                    <a href="https://2captcha.com/enterpage" class="action-button">
                        💰 Add Funds to 2Captcha Account
                    </a>
                    
                    <a href="https://2captcha.com/2captcha-api#balance" class="action-button">
                        📊 Check Balance API
                    </a>
                </div>
                
                <div class="footer">
                    <p>This alert was generated by the Job Scraper Balance Monitor.</p>
                    <p>Server: ${require('os').hostname()} | Time: ${new Date().toISOString()}</p>
                    <p>To modify alert settings, update the BALANCE_ALERT_THRESHOLD environment variable.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate plain text email for fallback
     * @param {number} balance - Current balance
     * @param {Object} stats - System statistics
     * @returns {string} - Plain text email content
     */
    generatePlainTextEmail(balance, stats) {
        const isUrgent = balance < 1.0;
        const urgencyText = isUrgent ? 'URGENT' : 'WARNING';
        
        return `
🚨 ${urgencyText}: 2Captcha Balance Alert

Current Balance: $${balance}
Alert Threshold: $${this.alertThreshold}
Status: ${urgencyText}
Check Time: ${new Date().toLocaleString()}

SYSTEM INFORMATION:
- API Key: ${stats.apiKey}
- Total Jobs: ${stats.totalJobs || 'N/A'}
- Jobs Today: ${stats.jobsToday || 'N/A'}
- Last Scraping: ${stats.lastScraping || 'N/A'}

RECOMMENDED ACTIONS:
1. Add funds to your 2Captcha account: https://2captcha.com/enterpage
2. Monitor CAPTCHA usage in system logs
3. Consider optimizing scraping frequency if needed
${isUrgent ? '4. URGENT: Add funds immediately to prevent service interruption' : ''}

This alert was generated by the Job Scraper Balance Monitor.
Server: ${require('os').hostname()}
Time: ${new Date().toISOString()}
        `.trim();
    }

    /**
     * Get system statistics for email context
     * @returns {Promise<Object>} - System stats
     */
    async getSystemStats() {
        try {
            const solverStats = this.captchaSolver.getStats();
            
            // Try to get job scraping statistics from database or logs
            let jobStats = {};
            try {
                // This would be expanded to get actual job statistics
                jobStats = {
                    totalJobs: 'N/A',
                    jobsToday: 'N/A',
                    lastScraping: 'N/A',
                    systemStatus: 'Active'
                };
            } catch (error) {
                console.warn('⚠️ Could not get job statistics:', error.message);
            }
            
            return {
                ...solverStats,
                ...jobStats
            };
            
        } catch (error) {
            console.warn('⚠️ Could not get system stats:', error.message);
            return {
                apiKey: 'Unknown',
                totalJobs: 'N/A',
                jobsToday: 'N/A',
                lastScraping: 'N/A',
                systemStatus: 'Unknown'
            };
        }
    }

    /**
     * Check if we should send an alert (avoid spam)
     * @param {number} currentBalance - Current balance
     * @returns {Promise<boolean>} - Whether to send alert
     */
    async shouldSendAlert(currentBalance) {
        try {
            const lastAlert = await this.getLastAlert();
            
            if (!lastAlert) {
                console.log('📧 No previous alert found, sending alert');
                return true;
            }
            
            const timeSinceLastAlert = Date.now() - new Date(lastAlert.timestamp).getTime();
            const hoursSinceLastAlert = timeSinceLastAlert / (1000 * 60 * 60);
            
            // Send alert if:
            // 1. More than 6 hours since last alert, OR
            // 2. Balance dropped significantly since last alert (more than $1), OR
            // 3. Balance is critically low (< $1) and more than 2 hours since last alert
            const shouldSend = 
                hoursSinceLastAlert > 6 ||
                (lastAlert.balance - currentBalance) > 1.0 ||
                (currentBalance < 1.0 && hoursSinceLastAlert > 2);
            
            if (shouldSend) {
                console.log(`📧 Sending alert (${hoursSinceLastAlert.toFixed(1)}h since last alert)`);
            } else {
                console.log(`⏰ Skipping alert (${hoursSinceLastAlert.toFixed(1)}h since last alert, threshold not met)`);
            }
            
            return shouldSend;
            
        } catch (error) {
            console.warn('⚠️ Could not check last alert, sending anyway:', error.message);
            return true;
        }
    }

    /**
     * Save current state to file
     * @param {Object} state - Current state
     */
    async saveState(state) {
        try {
            await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
        } catch (error) {
            console.warn('⚠️ Could not save state:', error.message);
        }
    }

    /**
     * Get last alert information
     * @returns {Promise<Object|null>} - Last alert data
     */
    async getLastAlert() {
        try {
            const data = await fs.readFile(this.lastAlertFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    /**
     * Record that an alert was sent
     * @param {number} balance - Balance when alert was sent
     */
    async recordAlertSent(balance) {
        try {
            const alertRecord = {
                timestamp: new Date().toISOString(),
                balance: balance,
                recipient: this.emailRecipient,
                threshold: this.alertThreshold
            };
            
            await fs.writeFile(this.lastAlertFile, JSON.stringify(alertRecord, null, 2));
            console.log('📝 Alert record saved');
        } catch (error) {
            console.warn('⚠️ Could not save alert record:', error.message);
        }
    }

    /**
     * Get current state
     * @returns {Promise<Object|null>} - Current state
     */
    async getState() {
        try {
            const data = await fs.readFile(this.stateFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    /**
     * Test email configuration
     * @returns {Promise<Object>} - Test result
     */
    async testEmailConfig() {
        try {
            console.log('📧 Testing email configuration...');
            
            const transporter = nodemailer.createTransport(this.emailConfig);
            await transporter.verify();
            
            console.log('✅ Email configuration test passed');
            return {
                success: true,
                message: 'Email server connection successful'
            };
            
        } catch (error) {
            console.error('❌ Email configuration test failed:', error.message);
            return {
                success: false,
                error: error.message,
                config: {
                    host: this.emailConfig.host,
                    port: this.emailConfig.port,
                    user: this.emailConfig.auth.user ? 'Set' : 'Not set',
                    pass: this.emailConfig.auth.pass ? 'Set' : 'Not set'
                }
            };
        }
    }

    /**
     * Send test email
     * @returns {Promise<Object>} - Test result
     */
    async sendTestEmail() {
        try {
            console.log('📧 Sending test email...');
            
            const transporter = nodemailer.createTransport(this.emailConfig);
            
            const mailOptions = {
                from: 'lernen@learnandearn.me',
                to: this.emailRecipient,
                subject: '✅ Balance Monitor Test Email',
                html: `
                    <h2>✅ Balance Monitor Test</h2>
                    <p>This is a test email from the Job Scraper Balance Monitor.</p>
                    <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Server:</strong> ${require('os').hostname()}</p>
                    <p>If you received this email, the balance monitoring system is working correctly.</p>
                `,
                text: `Balance Monitor Test Email\n\nThis is a test email from the Job Scraper Balance Monitor.\nTime: ${new Date().toLocaleString()}\nServer: ${require('os').hostname()}`
            };
            
            const result = await transporter.sendMail(mailOptions);
            console.log('✅ Test email sent successfully');
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: this.emailRecipient
            };
            
        } catch (error) {
            console.error('❌ Failed to send test email:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = BalanceMonitor;