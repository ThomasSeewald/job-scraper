# 💰 2Captcha Balance Monitoring System

Automated monitoring and email alerting system for 2Captcha account balance. Sends alerts to `thomas.seewald@gmail.com` when balance drops below $5.

## 🚀 **Features**

### ✅ **Automated Monitoring**
- **Scheduled Balance Checks**: Every 4 hours by default
- **Smart Alerting**: Prevents email spam with intelligent alert throttling
- **Multiple Thresholds**: Warning at $5, Critical alerts below $1
- **Real-time Status**: Instant balance checking on demand

### 📧 **Email Notifications**
- **Rich HTML Emails**: Professional formatting with system statistics
- **Multiple Recipients**: Configurable email addresses
- **Alert Suppression**: Prevents duplicate alerts (6-hour minimum interval)
- **Test Functionality**: Verify email configuration before deployment

### 🔧 **Advanced Configuration**
- **Flexible Scheduling**: Customizable cron expressions
- **Environment-based Setup**: Secure credential management
- **Logging & Monitoring**: Comprehensive activity logs
- **Manual Triggers**: On-demand balance checks and alerts

## 📋 **Quick Start**

### 1. **Check Current Balance**
```bash
npm run check-balance-only
```

### 2. **Configure Email (Required for Alerts)**
```bash
# Set Gmail credentials
export SMTP_USER="your-gmail@gmail.com"
export SMTP_PASS="your-app-password"

# Test email configuration
npm run test-email
```

### 3. **Send Test Email**
```bash
npm run send-test-email
```

### 4. **Start Automated Monitoring**
```bash
npm run monitor-balance
```

## ⚙️ **Configuration**

### **Environment Variables**
```bash
# Balance Monitoring
BALANCE_ALERT_THRESHOLD=5.0                    # Alert when balance < $5
ALERT_EMAIL=thomas.seewald@gmail.com           # Recipient email
BALANCE_CHECK_SCHEDULE="0 */4 * * *"           # Every 4 hours

# Email Configuration (Gmail)
SMTP_HOST=smtp.gmail.com                       # Gmail SMTP server
SMTP_PORT=587                                  # Gmail SMTP port
SMTP_USER=your-gmail@gmail.com                 # Your Gmail address
SMTP_PASS=your-app-password                    # Gmail App Password

# 2Captcha API
CAPTCHA_API_KEY=your_2captcha_api_key          # Your 2Captcha API key
```

### **Gmail App Password Setup**
1. Enable 2-Factor Authentication on Gmail
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate new App Password for "Mail"
4. Use this password in `SMTP_PASS` environment variable

## 🛠️ **Commands**

### **Balance Checking**
```bash
npm run check-balance              # Check balance and send alerts if needed
npm run check-balance-only         # Check balance without sending alerts
npm run balance-status             # Show current status and configuration
```

### **Email Testing**
```bash
npm run test-email                 # Test email server connection
npm run send-test-email            # Send test email to verify delivery
```

### **Monitoring**
```bash
npm run monitor-balance            # Start automated monitoring (4-hour schedule)
```

### **Manual Operations**
```bash
node balance-check.js --force-alert     # Force send alert regardless of balance
node balance-check.js --status          # Detailed status and configuration
```

## 📊 **Alert System**

### **Alert Thresholds**
- **$5.00**: Warning alert (configurable via `BALANCE_ALERT_THRESHOLD`)
- **$1.00**: Critical alert (immediate attention required)
- **$0.50**: Urgent alert (service interruption imminent)

### **Alert Suppression Logic**
- **6-hour minimum** between regular alerts
- **2-hour minimum** for critical alerts (< $1)
- **Immediate alert** if balance drops significantly (> $1 difference)

### **Email Content**
- **Current balance** and threshold information
- **System statistics** (jobs scraped, last activity)
- **Usage estimates** (remaining CAPTCHA solves)
- **Direct links** to 2Captcha dashboard
- **Recommended actions** based on balance level

## 🔍 **Usage Examples**

### **Basic Balance Check**
```bash
$ npm run check-balance-only

💰 Current balance: $18.552
⚠️  Alert threshold: $5
✅ Status: SUFFICIENT
   Buffer above threshold: $13.55
📊 Estimated remaining CAPTCHA solves: ~18,552
```

### **Email Configuration Test**
```bash
$ npm run test-email

✅ Email configuration test passed
   SMTP server connection successful
   Ready to send balance alerts
```

### **Automated Monitoring Status**
```bash
$ npm run balance-status

🔧 Configuration:
   Alert Threshold: $5
   Alert Email: thomas.seewald@gmail.com
   API Key: 2946675b...
   SMTP Host: smtp.gmail.com:587

📈 Last Balance Check:
   Balance: $18.552
   Timestamp: 2/6/2025, 8:15:00 PM
   Below Threshold: NO ✅
   Alert Sent: NO
```

## 📅 **Scheduling Options**

### **Default Schedule**
- **Every 4 hours**: `0 */4 * * *`
- **Timezone**: Europe/Berlin (configurable)

### **Custom Schedules**
```bash
# Every hour
BALANCE_CHECK_SCHEDULE="0 * * * *"

# Twice daily (9 AM and 6 PM)
BALANCE_CHECK_SCHEDULE="0 9,18 * * *"

# Business hours only (9 AM - 6 PM, weekdays)
BALANCE_CHECK_SCHEDULE="0 9-18 * * 1-5"
```

### **Schedule Examples**
| Schedule | Cron Expression | Description |
|----------|----------------|-------------|
| Every 4 hours | `0 */4 * * *` | Default monitoring |
| Every hour | `0 * * * *` | Frequent monitoring |
| Daily at 9 AM | `0 9 * * *` | Daily check |
| Twice daily | `0 9,18 * * *` | Morning and evening |
| Business hours | `0 9-18 * * 1-5` | Weekdays only |

## 🚨 **Alert Examples**

### **Warning Alert (Balance < $5)**
```
Subject: 🚨 2Captcha Balance Alert - $3.45 remaining

WARNING: Your 2Captcha account balance has dropped below $5.00
Current Balance: $3.45
Status: WARNING
Estimated CAPTCHA solves remaining: ~3,450

Recommended Actions:
1. Add funds to your 2Captcha account
2. Monitor CAPTCHA usage in system logs
3. Consider optimizing scraping frequency if needed
```

### **Critical Alert (Balance < $1)**
```
Subject: 🚨 URGENT: 2Captcha Balance Alert - $0.75 remaining

URGENT: Balance is critically low! Service may be interrupted.
Current Balance: $0.75
Status: CRITICAL
Estimated CAPTCHA solves remaining: ~750

IMMEDIATE ACTION REQUIRED:
Add funds immediately to prevent service interruption
```

## 🔧 **Integration with Job Scraper**

### **Automatic Integration**
The balance monitor automatically integrates with the job scraping system:

1. **Before Scraping**: Check balance to ensure sufficient funds
2. **During Scraping**: Monitor CAPTCHA solving costs
3. **After Scraping**: Log usage statistics for alerts
4. **Continuous Monitoring**: 4-hour schedule ensures early warning

### **Manual Integration**
```javascript
const BalanceMonitor = require('./src/balance-monitor');

// Check balance before starting scraping
const monitor = new BalanceMonitor();
const balanceResult = await monitor.checkBalance();

if (balanceResult.belowThreshold) {
    console.log('⚠️ Balance below threshold, consider adding funds');
}
```

## 📈 **Monitoring & Logs**

### **Log Files**
- **`balance-monitor.log`**: Scheduled check results
- **`balance-state.json`**: Current balance state
- **`last-alert.json`**: Last alert information

### **Log Format**
```
2025-02-06T19:15:00.000Z | SUCCESS | Balance: $18.552 | Below Threshold: NO | Alert Sent: NO
2025-02-06T23:15:00.000Z | SUCCESS | Balance: $17.234 | Below Threshold: NO | Alert Sent: NO
2025-02-07T03:15:00.000Z | SUCCESS | Balance: $4.123 | Below Threshold: YES | Alert Sent: YES
```

### **Monitoring Commands**
```bash
# View recent log entries
tail -f balance-monitor.log

# Check current state
cat balance-state.json

# View last alert
cat last-alert.json
```

## 🔒 **Security & Privacy**

### **API Key Protection**
- ✅ Environment variables (not in source code)
- ✅ Masked in logs (`2946675b...`)
- ✅ Separate keys for different environments

### **Email Security**
- ✅ Gmail App Passwords (more secure than account password)
- ✅ TLS encryption for SMTP connection
- ✅ No email content stored in logs

### **Data Privacy**
- ✅ Balance information only stored locally
- ✅ No transmission to third parties
- ✅ Automatic cleanup of old logs

## 🔧 **Troubleshooting**

### **Common Issues**

#### **1. Email Not Working**
```
❌ Error: Missing credentials for "PLAIN"
```
**Solution**: Set Gmail credentials
```bash
export SMTP_USER="your-gmail@gmail.com"
export SMTP_PASS="your-app-password"
```

#### **2. Gmail Authentication Failed**
```
❌ Error: Invalid login: 535-5.7.8 Username and Password not accepted
```
**Solutions**:
- Enable 2-Factor Authentication
- Use App Password (not account password)
- Check [Gmail App Passwords](https://myaccount.google.com/apppasswords)

#### **3. Balance Check Failed**
```
❌ Error: Invalid API key
```
**Solution**: Verify 2Captcha API key
```bash
export CAPTCHA_API_KEY="your_correct_api_key"
npm run check-balance-only
```

#### **4. No Alerts Sent**
```
⏰ Alert not sent (too soon since last alert)
```
**Explanation**: Normal behavior - prevents spam
**Override**: Use `--force-alert` for testing

### **Debug Commands**
```bash
# Test all components
npm run balance-status

# Test email only
npm run test-email

# Check 2Captcha connection
npm run check-balance-only

# Force alert for testing
node balance-check.js --force-alert
```

## 🚀 **Production Deployment**

### **1. Environment Setup**
```bash
# Required variables
export CAPTCHA_API_KEY="your_2captcha_key"
export SMTP_USER="your-gmail@gmail.com"
export SMTP_PASS="your-app-password"

# Optional customization
export BALANCE_ALERT_THRESHOLD="3.0"
export ALERT_EMAIL="admin@yourdomain.com"
```

### **2. Verify Configuration**
```bash
npm run balance-status
npm run test-email
npm run send-test-email
```

### **3. Start Monitoring**
```bash
# Background monitoring
nohup npm run monitor-balance > balance-monitor.log 2>&1 &

# Or with PM2
pm2 start "npm run monitor-balance" --name "balance-monitor"
```

### **4. Integration with Existing Cron**
```bash
# Add to existing crontab
0 */4 * * * cd /path/to/job-scraper && npm run check-balance
```

## 📊 **API Reference**

### **BalanceMonitor Class**
```javascript
const BalanceMonitor = require('./src/balance-monitor');
const monitor = new BalanceMonitor();

// Check balance and send alerts
const result = await monitor.checkBalance();

// Send alert manually
const emailResult = await monitor.sendBalanceAlert(currentBalance);

// Test email configuration
const testResult = await monitor.testEmailConfig();

// Get current state
const state = await monitor.getState();
```

### **Command Line Interface**
```bash
# Balance operations
node balance-check.js                    # Full check with alerts
node balance-check.js --check-only       # Balance only
node balance-check.js --status           # Status and config

# Email operations  
node balance-check.js --test-email       # Test SMTP connection
node balance-check.js --send-test        # Send test email
node balance-check.js --force-alert      # Force alert

# Monitoring
node src/balance-scheduler.js            # Start scheduler
```

## 🎯 **Best Practices**

### **Production Use**
1. **Monitor Logs**: Set up log rotation and monitoring
2. **Test Regularly**: Send test emails monthly
3. **Backup Configuration**: Keep environment variables backed up
4. **Multiple Thresholds**: Consider multiple alert levels
5. **Integration**: Include in system health checks

### **Security**
1. **App Passwords**: Use Gmail App Passwords, not account passwords
2. **Environment Variables**: Never commit credentials to code
3. **Key Rotation**: Rotate API keys periodically
4. **Access Control**: Limit access to configuration files

### **Monitoring**
1. **Balance Trends**: Track balance consumption patterns
2. **Alert Frequency**: Monitor how often alerts are triggered
3. **Email Delivery**: Verify emails are being received
4. **System Health**: Include in overall system monitoring

## 📞 **Support & Maintenance**

### **Current Status**
- ✅ **2Captcha Balance**: $18.552 (sufficient for ~18,552 solves)
- ✅ **Alert Threshold**: $5.00
- ✅ **Email Recipient**: thomas.seewald@gmail.com
- ⚠️ **Email Configuration**: Requires Gmail App Password setup

### **Maintenance Schedule**
- **Daily**: Automated balance checks (every 4 hours)
- **Weekly**: Review balance consumption trends
- **Monthly**: Test email configuration
- **Quarterly**: Review and update alert thresholds

### **Contact**
- **Email Alerts**: thomas.seewald@gmail.com
- **2Captcha Dashboard**: https://2captcha.com/enterpage
- **Gmail App Passwords**: https://myaccount.google.com/apppasswords