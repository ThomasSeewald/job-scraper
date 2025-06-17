const puppeteer = require('puppeteer');
const EmailExtractor = require('./email-extractor');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

class PersistentPuppeteerService {
    constructor() {
        this.browser = null;
        this.page = null;
        this.emailExtractor = new EmailExtractor();
        this.captchaSolver = new IndependentCaptchaSolver();
        this.isInitialized = false;
        this.navigationQueue = [];
        this.isProcessing = false;
        this.healthCheckInterval = null;
        
        console.log('🚀 Persistent Puppeteer Service initialized');
    }

    /**
     * Initialize the persistent browser and page
     */
    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        try {
            console.log('🌐 Starting persistent Puppeteer browser...');
            
            // Use headless mode for cron jobs, non-headless for manual testing
            const isHeadless = process.env.HEADLESS_MODE === 'true' || process.argv.includes('--headless');
            console.log(`🖥️ Browser mode: ${isHeadless ? 'headless (background)' : 'visible (interactive)'}`);
            
            this.browser = await puppeteer.launch({
                headless: isHeadless,
                defaultViewport: null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1400,900',
                    '--window-position=100,100'
                ]
            });

            this.page = await this.browser.newPage();
            
            // Set user agent to appear more human-like
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Set viewport
            await this.page.setViewport({ width: 1366, height: 768 });
            
            // Add admin mode visual indicators
            await this.addAdminModeIndicators();
            
            this.isInitialized = true;
            console.log('✅ Persistent Puppeteer browser ready');
            
            // Start health check monitoring
            this.startHealthMonitoring();
            
            // Start processing queue
            this.processQueue();
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Puppeteer:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * Navigate to a job detail page with automatic CAPTCHA solving
     */
    async navigateToJob(refnr, includeEmailExtraction = false) {
        return new Promise((resolve, reject) => {
            const request = {
                refnr,
                includeEmailExtraction,
                resolve,
                reject,
                timestamp: Date.now()
            };

            this.navigationQueue.push(request);
            console.log(`📋 Added job ${refnr} to navigation queue (position: ${this.navigationQueue.length})`);

            // Start processing if not already running
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    /**
     * Process the navigation queue sequentially
     */
    async processQueue() {
        if (this.isProcessing || this.navigationQueue.length === 0) {
            return;
        }

        this.isProcessing = true;
        console.log(`🔄 Processing navigation queue (${this.navigationQueue.length} items)`);

        while (this.navigationQueue.length > 0) {
            const request = this.navigationQueue.shift();
            
            try {
                const result = await this.executeNavigation(request);
                request.resolve(result);
            } catch (error) {
                console.error(`❌ Navigation failed for ${request.refnr}:`, error);
                request.reject(error);
            }

            // Small delay between navigations
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.isProcessing = false;
        console.log('✅ Navigation queue processing completed');
    }

    /**
     * Execute the actual navigation with CAPTCHA handling
     */
    async executeNavigation(request) {
        const { refnr, includeEmailExtraction } = request;
        const startTime = Date.now();

        try {
            // Check browser and page health before navigation
            let healthCheck;
            try {
                healthCheck = await this.checkBrowserHealth();
            } catch (error) {
                console.log('⚠️ Health check failed:', error.message);
                healthCheck = { healthy: false, reason: 'Health check error' };
            }
            
            if (!healthCheck.healthy) {
                console.log('⚠️ Browser unhealthy, reinitializing...');
                await this.reinitialize();
            }

            if (!this.isInitialized) {
                const initialized = await this.initialize();
                if (!initialized) {
                    throw new Error('Failed to initialize Puppeteer');
                }
            }

            const arbeitsagenturUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
            console.log(`🔍 Navigating to: ${arbeitsagenturUrl}`);

            // Navigate to page with retry logic
            let navigationSuccess = false;
            let retries = 0;
            const maxRetries = 3;

            while (!navigationSuccess && retries < maxRetries) {
                try {
                    // Check if we need a fresh page (detached frame prevention)
                    const needsNewPage = retries > 0 || !(await this.isPageHealthy());
                    if (needsNewPage) {
                        console.log('🔄 Creating fresh page to avoid frame issues...');
                        await this.createFreshPage();
                    }
                    
                    await this.page.goto(arbeitsagenturUrl, { 
                        waitUntil: 'networkidle2',
                        timeout: 30000 
                    });
                    navigationSuccess = true;
                } catch (navError) {
                    retries++;
                    console.log(`⚠️ Navigation attempt ${retries} failed: ${navError.message}`);
                    
                    if (navError.message.includes('detached Frame') || 
                        navError.message.includes('Target closed') ||
                        navError.message.includes('Execution context was destroyed')) {
                        console.log('🔄 Frame/context issue detected, will retry with fresh page...');
                        // Don't reinitialize entire browser, just get a new page
                        if (retries < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    } else if (retries < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        throw navError;
                    }
                }
            }

            // Wait a bit for dynamic content
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Add admin mode indicators to the current page
            await this.addIndicatorsToCurrentPage();

            // Check for and solve CAPTCHA
            const captchaSolved = await this.detectAndSolveCaptcha();
            
            let emails = [];
            let emailResult = null;

            // Extract emails if requested
            if (includeEmailExtraction) {
                try {
                    const html = await this.page.content();
                    emailResult = this.emailExtractor.extractPrioritizedEmails(html, '', '');
                    emails = emailResult.emails ? emailResult.emails.split(',').map(e => e.trim()).filter(e => e) : [];
                    console.log(`📧 Extracted ${emails.length} emails: ${emails.join(', ')}`);
                } catch (emailError) {
                    console.error('❌ Email extraction error:', emailError.message);
                }
            }

            // Take screenshot for verification
            const screenshot = await this.page.screenshot({ 
                type: 'png', 
                fullPage: false 
            });

            const duration = Date.now() - startTime;
            console.log(`✅ Navigation completed for ${refnr} in ${duration}ms (CAPTCHA: ${captchaSolved ? 'solved' : 'none'})`);

            return {
                success: true,
                refnr,
                url: arbeitsagenturUrl,
                captchaSolved,
                emails,
                emailResult,
                screenshot: screenshot.toString('base64'),
                loadTime: duration,
                timestamp: Date.now()
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Navigation error for ${refnr}:`, error.message);
            
            return {
                success: false,
                refnr,
                error: error.message,
                loadTime: duration,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Detect and solve CAPTCHA if present
     */
    async detectAndSolveCaptcha() {
        try {
            console.log('🔍 Looking for CAPTCHA on page...');
            
            // Check specifically for Arbeitsagentur CAPTCHA input field
            const captchaFieldExists = await this.page.$('#kontaktdaten-captcha-input') !== null;
            console.log(`📝 CAPTCHA field exists: ${captchaFieldExists}`);
            
            if (!captchaFieldExists) {
                console.log('🔍 No CAPTCHA field found');
                return false; // No CAPTCHA detected
            }
            
            console.log('🎯 CAPTCHA detected! Looking for CAPTCHA image...');
            
            // Scroll to CAPTCHA area with error handling
            console.log('📜 Scrolling to CAPTCHA area...');
            try {
                await this.page.evaluate(() => {
                    var element = document.querySelector('#kontaktdaten-captcha-input'); 
                    if(element) {
                        element.scrollIntoView({behavior: 'smooth',block: 'end',inline: 'nearest'});
                    }
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (scrollError) {
                console.log('⚠️ Error scrolling to CAPTCHA:', scrollError.message);
                if (scrollError.message.includes('detached Frame')) {
                    throw scrollError; // Re-throw to trigger reinitialize
                }
            }
            
            // Find CAPTCHA image with multiple selectors
            const captchaSelectors = [
                'img[src*="captcha"]',
                'img[alt*="captcha"]',
                'img[alt*="Captcha"]',
                'img[alt*="CAPTCHA"]',
                '.captcha img',
                '#captcha img'
            ];
            
            let captchaImage = null;
            for (const selector of captchaSelectors) {
                captchaImage = await this.page.$(selector);
                if (captchaImage) {
                    console.log(`📷 Found CAPTCHA image with selector: ${selector}`);
                    break;
                }
            }
            
            if (!captchaImage) {
                console.log('❌ CAPTCHA image not found with any selector');
                return false;
            }
            
            // Get CAPTCHA image URL from DOM with error handling
            let captchaImageUrl = null;
            try {
                captchaImageUrl = await this.page.evaluate(() => {
                    const images = document.querySelectorAll('img');
                    for (const img of images) {
                        if (img.src && (img.src.includes('captcha') || img.alt && img.alt.toLowerCase().includes('captcha'))) {
                            console.log('Found CAPTCHA image URL:', img.src);
                            return img.src;
                        }
                    }
                    return null;
                });
            } catch (evalError) {
                console.log('⚠️ Error evaluating CAPTCHA image URL:', evalError.message);
                if (evalError.message.includes('detached Frame')) {
                    throw evalError; // Re-throw to trigger reinitialize
                }
                return false;
            }
            
            console.log(`🔗 CAPTCHA image URL found: ${captchaImageUrl}`);
            
            if (!captchaImageUrl) {
                console.log('❌ Could not find CAPTCHA image URL in DOM');
                return false;
            }
            
            // Solve CAPTCHA using independent solver
            console.log('🧩 Solving CAPTCHA using independent solver...');
            const solutionResult = await this.captchaSolver.solveCaptchaFromUrl(captchaImageUrl);
            
            if (!solutionResult.success) {
                console.log(`❌ CAPTCHA solving failed: ${solutionResult.error}`);
                return false;
            }
            
            const solution = solutionResult.text || solutionResult.solution;
            console.log(`✅ CAPTCHA solved: ${solution}`);
            
            if (solution) {
                // Enter solution into the specific CAPTCHA input field
                console.log(`🔤 Entering CAPTCHA solution: '${solution}' into input field...`);
                
                await this.page.evaluate((captchaSolution) => {
                    var captchaInput = document.getElementById('kontaktdaten-captcha-input');
                    if (captchaInput) {
                        captchaInput.value = '';
                        captchaInput.value = captchaSolution;
                        
                        // Dispatch events to ensure proper detection
                        var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                        var changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        captchaInput.dispatchEvent(inputEvent);
                        captchaInput.dispatchEvent(changeEvent);
                        captchaInput.focus();
                        captchaInput.blur();
                    }
                }, solution);
                
                console.log('🔤 CAPTCHA solution entered, waiting before clicking submit...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Click the specific submit button
                const clicked = await this.page.evaluate(() => {
                    var element = document.querySelector('#kontaktdaten-captcha-absenden-button');
                    if (element) {
                        element.click();
                        return true;
                    }
                    return false;
                });
                
                if (clicked) {
                    console.log('🔘 Submit button clicked, waiting for CAPTCHA validation...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // Check if CAPTCHA was solved by looking for absence of "sicherheitsabfrage"
                    const pageText = await this.page.evaluate(() => document.body.textContent.toLowerCase());
                    
                    if (!pageText.includes('sicherheitsabfrage')) {
                        console.log('✅ CAPTCHA solved successfully!');
                        return true;
                    } else {
                        console.log('❌ CAPTCHA solution was incorrect');
                        return false;
                    }
                } else {
                    console.log('❌ Submit button not found');
                    return false;
                }
            }
            
            return false;
            
        } catch (error) {
            console.log('❌ CAPTCHA handling error:', error.message);
            return false;
        }
    }

    /**
     * Get current page URL
     */
    async getCurrentUrl() {
        if (!this.page) {
            return null;
        }
        return await this.page.url();
    }

    /**
     * Get queue status
     */
    getQueueStatus() {
        return {
            isInitialized: this.isInitialized,
            isProcessing: this.isProcessing,
            queueLength: this.navigationQueue.length,
            currentUrl: this.page ? this.page.url() : null
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        console.log('🧹 Cleaning up Persistent Puppeteer Service...');
        
        // Stop health monitoring
        this.stopHealthMonitoring();
        
        if (this.page) {
            try {
                await this.page.close();
            } catch (error) {
                console.log('⚠️ Error closing page:', error.message);
            }
            this.page = null;
        }
        
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                console.log('⚠️ Error closing browser:', error.message);
            }
            this.browser = null;
        }
        
        this.isInitialized = false;
        this.navigationQueue = [];
        this.isProcessing = false;
        
        console.log('✅ Persistent Puppeteer Service cleanup completed');
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.isInitialized || !this.browser || !this.page) {
                return { healthy: false, error: 'Not initialized' };
            }

            // Test if browser is still responsive
            const url = await this.page.url();
            
            return {
                healthy: true,
                url,
                queueLength: this.navigationQueue.length,
                isProcessing: this.isProcessing
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }

    /**
     * Check browser and page health
     */
    async checkBrowserHealth() {
        try {
            if (!this.browser || !this.page) {
                return { healthy: false, reason: 'Browser or page not initialized' };
            }

            // Check if browser is connected
            if (!this.browser.isConnected()) {
                return { healthy: false, reason: 'Browser disconnected' };
            }

            // Try to evaluate a simple script to check if page is responsive
            try {
                await this.page.evaluate(() => true);
            } catch (evalError) {
                // If evaluation fails, check if it's a detached frame error
                if (evalError.message.includes('detached Frame') || 
                    evalError.message.includes('Execution context was destroyed') ||
                    evalError.message.includes('Target closed')) {
                    return { healthy: false, reason: `Page context lost: ${evalError.message}` };
                }
                throw evalError;
            }
            
            // Also check if we can get the URL (another indicator of page health)
            try {
                await this.page.url();
            } catch (urlError) {
                return { healthy: false, reason: `Cannot access page URL: ${urlError.message}` };
            }
            
            return { healthy: true };
        } catch (error) {
            return { healthy: false, reason: error.message };
        }
    }

    /**
     * Reinitialize browser and page after failure
     */
    async reinitialize() {
        console.log('🔄 Reinitializing Puppeteer browser...');
        
        // Cleanup existing resources
        try {
            if (this.page) {
                // Try to close page, ignore if already closed
                await this.page.close().catch(() => {});
            }
        } catch (error) {
            console.log('⚠️ Error closing page:', error.message);
        }

        try {
            if (this.browser && this.browser.isConnected()) {
                await this.browser.close();
            }
        } catch (error) {
            console.log('⚠️ Error closing browser:', error.message);
        }

        // Reset state
        this.browser = null;
        this.page = null;
        this.isInitialized = false;

        // Wait a bit before reinitializing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Reinitialize
        return await this.initialize();
    }

    /**
     * Check if current page is healthy
     */
    async isPageHealthy() {
        try {
            if (!this.page) return false;
            
            // Quick health check
            await this.page.evaluate(() => true);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Create a fresh page and close the old one
     */
    async createFreshPage() {
        try {
            // Create new page first
            const newPage = await this.browser.newPage();
            
            // Set user agent
            await newPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Set viewport
            await newPage.setViewport({ width: 1366, height: 768 });
            
            // Close old page if exists
            if (this.page) {
                try {
                    await this.page.close();
                } catch (error) {
                    console.log('⚠️ Error closing old page:', error.message);
                }
            }
            
            // Replace with new page
            this.page = newPage;
            
            // Add admin mode indicators to new page
            await this.addAdminModeIndicators();
            
            console.log('✅ Fresh page created');
        } catch (error) {
            console.error('❌ Error creating fresh page:', error.message);
            throw error;
        }
    }

    /**
     * Start periodic health monitoring
     */
    startHealthMonitoring() {
        // Clear any existing interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        // Check health every 30 seconds
        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.checkBrowserHealth();
                if (!health.healthy) {
                    console.log(`⚠️ Health check failed: ${health.reason}`);
                    console.log('🔄 Auto-reinitializing browser...');
                    await this.reinitialize();
                }
            } catch (error) {
                console.log('❌ Health check error:', error.message);
            }
        }, 30000); // 30 seconds

        console.log('🏥 Health monitoring started (checking every 30s)');
    }

    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('🏥 Health monitoring stopped');
        }
    }

    /**
     * Add visual indicators to show this is admin mode with CAPTCHA automation
     */
    async addAdminModeIndicators() {
        try {
            // Navigate to a blank page first to add indicators
            await this.page.goto('about:blank');
            
            // Set window title
            await this.page.evaluate(() => {
                document.title = '🚀 ADMIN MODE - Auto CAPTCHA Solver Active';
            });
            
            // Add admin mode banner and styling
            await this.page.evaluate(() => {
                // Create admin mode banner
                const banner = document.createElement('div');
                banner.id = 'admin-mode-banner';
                banner.innerHTML = `
                    <div style="
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: linear-gradient(90deg, #ff4757, #ff6b7a);
                        color: white;
                        padding: 10px 20px;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        font-weight: bold;
                        font-size: 16px;
                        text-align: center;
                        z-index: 999999;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                        border-bottom: 3px solid #ff3742;
                    ">
                        🚀 ADMIN MODUS AKTIV - Automatische CAPTCHA-Lösung läuft 🤖
                        <div style="font-size: 12px; margin-top: 5px; opacity: 0.9;">
                            Job-Navigation mit Puppeteer & 2captcha.com Integration
                        </div>
                    </div>
                `;
                document.body = document.body || document.createElement('body');
                document.body.appendChild(banner);
                
                // Add blinking border effect
                const style = document.createElement('style');
                style.textContent = `
                    @keyframes adminPulse {
                        0% { border-color: #ff4757; }
                        50% { border-color: #ffa502; }
                        100% { border-color: #ff4757; }
                    }
                    
                    html {
                        border: 5px solid #ff4757;
                        animation: adminPulse 2s infinite;
                        box-sizing: border-box;
                    }
                    
                    body {
                        margin-top: 80px !important;
                        padding-top: 0 !important;
                    }
                `;
                document.head = document.head || document.createElement('head');
                document.head.appendChild(style);
                
                console.log('🚀 Admin mode visual indicators added');
            });
            
        } catch (error) {
            console.log('⚠️ Could not add admin indicators:', error.message);
        }
    }

    /**
     * Add admin indicators to any page after navigation
     */
    async addIndicatorsToCurrentPage() {
        try {
            // Only add if not already present
            const bannerExists = await this.page.$('#admin-mode-banner');
            if (bannerExists) {
                return;
            }
            
            // Add banner to current page
            await this.page.evaluate(() => {
                if (document.getElementById('admin-mode-banner')) {
                    return;
                }
                
                const banner = document.createElement('div');
                banner.id = 'admin-mode-banner';
                banner.innerHTML = `
                    <div style="
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: linear-gradient(90deg, #ff4757, #ff6b7a);
                        color: white;
                        padding: 8px 15px;
                        font-family: Arial, sans-serif;
                        font-weight: bold;
                        font-size: 14px;
                        text-align: center;
                        z-index: 999999;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    ">
                        🚀 ADMIN MODE - Auto CAPTCHA Active 🤖
                    </div>
                `;
                
                document.body.insertBefore(banner, document.body.firstChild);
                
                // Add border styling
                if (!document.getElementById('admin-border-style')) {
                    const style = document.createElement('style');
                    style.id = 'admin-border-style';
                    style.textContent = `
                        html {
                            border: 3px solid #ff4757 !important;
                            box-sizing: border-box;
                        }
                        body {
                            margin-top: 50px !important;
                        }
                    `;
                    document.head.appendChild(style);
                }
            });
            
        } catch (error) {
            console.log('⚠️ Could not add indicators to current page:', error.message);
        }
    }
}

// Singleton instance
let puppeteerServiceInstance = null;

function getPuppeteerService() {
    if (!puppeteerServiceInstance) {
        puppeteerServiceInstance = new PersistentPuppeteerService();
    }
    return puppeteerServiceInstance;
}

module.exports = { PersistentPuppeteerService, getPuppeteerService };