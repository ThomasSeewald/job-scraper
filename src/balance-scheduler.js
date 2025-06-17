const cron = require('node-cron');
const BalanceMonitor = require('./balance-monitor');

class BalanceScheduler {
    constructor() {
        this.monitor = new BalanceMonitor();
        this.tasks = [];
        this.isRunning = false;
        
        // Default schedule: every 4 hours
        this.schedule = process.env.BALANCE_CHECK_SCHEDULE || '0 */4 * * *';
        
        console.log('⏰ Balance Scheduler initialized');
        console.log(`📅 Schedule: ${this.schedule} (every 4 hours)`);
    }

    /**
     * Start the scheduled balance monitoring
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️ Balance scheduler is already running');
            return;
        }

        console.log('🚀 Starting balance monitoring scheduler...');
        
        // Schedule regular balance checks
        const task = cron.schedule(this.schedule, async () => {
            await this.performScheduledCheck();
        }, {
            scheduled: false,
            timezone: process.env.TZ || 'Europe/Berlin'
        });

        this.tasks.push(task);
        task.start();
        
        this.isRunning = true;
        console.log('✅ Balance monitoring scheduler started');
        
        // Perform initial check
        this.performInitialCheck();
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️ Balance scheduler is not running');
            return;
        }

        console.log('⏹️ Stopping balance monitoring scheduler...');
        
        this.tasks.forEach(task => {
            task.stop();
        });
        
        this.tasks = [];
        this.isRunning = false;
        
        console.log('✅ Balance monitoring scheduler stopped');
    }

    /**
     * Perform initial balance check (delayed to avoid startup conflicts)
     */
    async performInitialCheck() {
        console.log('⏳ Scheduling initial balance check in 30 seconds...');
        
        setTimeout(async () => {
            console.log('🔍 Performing initial balance check...');
            await this.performScheduledCheck();
        }, 30000); // 30 second delay
    }

    /**
     * Perform a scheduled balance check
     */
    async performScheduledCheck() {
        const timestamp = new Date().toISOString();
        
        try {
            console.log('\n💰 Scheduled Balance Check');
            console.log('=========================');
            console.log(`🕐 Time: ${new Date().toLocaleString()}`);
            
            const result = await this.monitor.checkBalance();
            
            if (result.success) {
                console.log(`💰 Balance: $${result.balance}`);
                
                if (result.belowThreshold) {
                    console.log(`⚠️ ALERT: Balance below threshold ($${this.monitor.alertThreshold})`);
                    
                    if (result.alertSent) {
                        console.log('📧 Alert email sent to thomas.seewald@gmail.com');
                    } else {
                        console.log('⏰ Alert suppressed (too soon since last alert)');
                    }
                } else {
                    console.log('✅ Balance is sufficient');
                }
                
                // Log to file for monitoring
                await this.logCheckResult(result);
                
            } else {
                console.error(`❌ Balance check failed: ${result.error}`);
                await this.logCheckResult({ ...result, timestamp });
            }
            
            console.log('=========================\n');
            
        } catch (error) {
            console.error('❌ Scheduled balance check failed:', error.message);
            await this.logCheckResult({ 
                success: false, 
                error: error.message, 
                timestamp 
            });
        }
    }

    /**
     * Log check result to file for monitoring
     * @param {Object} result - Check result
     */
    async logCheckResult(result) {
        try {
            const fs = require('fs').promises;
            const path = require('path');
            
            const logFile = path.join(__dirname, '../balance-monitor.log');
            const logEntry = `${result.timestamp || new Date().toISOString()} | ${
                result.success ? 'SUCCESS' : 'FAILED'
            } | Balance: $${result.balance || 'N/A'} | Below Threshold: ${
                result.belowThreshold ? 'YES' : 'NO'
            } | Alert Sent: ${result.alertSent ? 'YES' : 'NO'}${
                result.error ? ` | Error: ${result.error}` : ''
            }\n`;
            
            await fs.appendFile(logFile, logEntry);
            
        } catch (error) {
            console.warn('⚠️ Could not write to log file:', error.message);
        }
    }

    /**
     * Get scheduler status
     * @returns {Object} - Scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            schedule: this.schedule,
            activeTasks: this.tasks.length,
            alertThreshold: this.monitor.alertThreshold,
            emailRecipient: this.monitor.emailRecipient,
            nextRun: this.isRunning && this.tasks.length > 0 ? 
                this.getNextRunTime() : null
        };
    }

    /**
     * Get next run time (approximate)
     * @returns {string} - Next run time
     */
    getNextRunTime() {
        try {
            // This is a simplified calculation
            // For exact times, you'd need to parse the cron expression
            const now = new Date();
            const nextRun = new Date(now);
            nextRun.setHours(nextRun.getHours() + 4); // Assuming 4-hour intervals
            return nextRun.toLocaleString();
        } catch (error) {
            return 'Unknown';
        }
    }

    /**
     * Manually trigger a balance check
     * @returns {Promise<Object>} - Check result
     */
    async triggerManualCheck() {
        console.log('🔧 Manual balance check triggered');
        return await this.monitor.checkBalance();
    }

    /**
     * Add custom schedule
     * @param {string} cronExpression - Cron expression
     * @param {string} description - Description of the schedule
     */
    addCustomSchedule(cronExpression, description = 'Custom check') {
        console.log(`⏰ Adding custom schedule: ${cronExpression} (${description})`);
        
        const task = cron.schedule(cronExpression, async () => {
            console.log(`🔍 ${description} - performing balance check...`);
            await this.performScheduledCheck();
        }, {
            scheduled: false,
            timezone: process.env.TZ || 'Europe/Berlin'
        });

        this.tasks.push(task);
        
        if (this.isRunning) {
            task.start();
        }
        
        console.log(`✅ Custom schedule added: ${description}`);
    }
}

module.exports = BalanceScheduler;

// If run directly, start the scheduler
if (require.main === module) {
    console.log('🚀 Starting Balance Monitoring Scheduler');
    console.log('=======================================\n');
    
    const scheduler = new BalanceScheduler();
    scheduler.start();
    
    // Keep the process running
    process.on('SIGINT', () => {
        console.log('\n📝 Received SIGINT, shutting down gracefully...');
        scheduler.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n📝 Received SIGTERM, shutting down gracefully...');
        scheduler.stop();
        process.exit(0);
    });
    
    console.log('⏰ Balance monitoring is now active');
    console.log('📧 Alerts will be sent to thomas.seewald@gmail.com when balance < $5');
    console.log('🔄 Press Ctrl+C to stop\n');
}