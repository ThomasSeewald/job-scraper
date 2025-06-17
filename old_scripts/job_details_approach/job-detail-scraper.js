const puppeteer = require('puppeteer');
const IndependentCaptchaSolver = require('./independent-captcha-solver');

class JobDetailScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isInitialized = false;
        this.maxCaptchaRetries = 3;
        
        // Initialize independent CAPTCHA solver
        this.captchaSolver = new IndependentCaptchaSolver();
        
        // For backward compatibility - check if we should use Odoo endpoint
        this.useOdooEndpoint = process.env.CAPTCHA_METHOD === 'odoo';
        this.captchaSolverUrl = process.env.CAPTCHA_SOLVER_URL;
        this.captchaApiKey = process.env.CAPTCHA_API_KEY;
    }

    /**
     * Initialize the browser
     * @param {boolean} headless - Whether to run in headless mode
     */
    async initialize(headless = true) {
        if (this.isInitialized) return;

        try {
            console.log(`🔧 Initializing browser for job detail scraping (headless: ${headless})...`);
            
            this.browser = await puppeteer.launch({
                headless: headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--window-size=1920,1080',
                    '--incognito' // Use incognito mode - no cookies, fresh session every time
                ],
                defaultViewport: null // Use full window size
                // Removed userDataDir to prevent cookie persistence
            });

            this.page = await this.browser.newPage();
            
            // Ignore page errors (like analytics tracking errors)
            this.page.on('pageerror', error => {
                console.log('⚠️ Page JavaScript error (ignored):', error.message.substring(0, 100));
            });
            
            // Set realistic user agent
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Set viewport
            await this.page.setViewport({ width: 1920, height: 1080 });
            
            // Enable request interception to handle cookies better
            await this.page.setRequestInterception(false);
            
            // Set additional headers that help with session persistence
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            });
            
            this.isInitialized = true;
            console.log('✅ Browser initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error);
            throw error;
        }
    }

    /**
     * Scrape detailed job information from Arbeitsagentur job detail page
     * @param {string} referenceNumber - Job reference number
     * @param {boolean} showBrowser - Whether to show the browser window
     * @returns {Promise<Object>} - Detailed job information
     */
    async scrapeJobDetails(referenceNumber, showBrowser = false) {
        await this.initialize(!showBrowser);
        
        const url = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${referenceNumber}`;
        
        try {
            console.log(`🔍 Scraping job details for: ${referenceNumber}`);
            
            console.log(`🌐 Navigating to: ${url}`);
            await this.page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            console.log('⏳ Waiting for page to load...');
            // Add a delay so you can see what's happening
            await this.delay(2000);

            // Handle CAPTCHA if present
            const captchaResult = await this.solveCaptcha();
            if (!captchaResult.success && !captchaResult.note) {
                console.error(`❌ Failed to solve CAPTCHA for: ${referenceNumber}`);
                return {
                    referenceNumber,
                    error: 'CAPTCHA solving failed',
                    scrapedAt: new Date().toISOString(),
                    url
                };
            } else if (captchaResult.note) {
                console.log(`⚠️ CAPTCHA handling note: ${captchaResult.note} - continuing with scraping`);
            } else {
                console.log('✅ CAPTCHA handled successfully - continuing with scraping');
            }

            // Wait for the main content to load
            try {
                await this.page.waitForSelector('.jobdetail', { timeout: 10000 });
                console.log('✅ Job detail section found');
            } catch (e) {
                console.log('⚠️ .jobdetail selector not found, trying alternative selectors...');
            }

            // Extract job details
            const jobDetails = await this.page.evaluate(() => {
                const extractText = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.textContent.trim() : null;
                };

                const extractAllText = (selector) => {
                    const elements = document.querySelectorAll(selector);
                    return Array.from(elements).map(el => el.textContent.trim());
                };

                // Main job information
                const title = extractText('.jobdetail h1') || extractText('.jobdetail-header h1');
                const company = extractText('.jobdetail-company') || extractText('[data-testid="company-name"]');
                const location = extractText('.jobdetail-location') || extractText('[data-testid="job-location"]');
                
                // Job description
                const description = extractText('.jobdetail-description') || 
                                 extractText('.jobad-description') || 
                                 extractText('.job-description');

                // Requirements
                const requirements = extractText('.jobdetail-requirements') || 
                                   extractText('.job-requirements') ||
                                   extractText('[data-testid="job-requirements"]');

                // Contact information
                const contactInfo = {
                    email: null,
                    phone: null,
                    website: null,
                    contactPerson: null
                };

                // Extract email addresses
                const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
                const pageText = document.body.textContent;
                const emails = pageText.match(emailRegex);
                if (emails && emails.length > 0) {
                    // Filter out common non-contact emails
                    const filteredEmails = emails.filter(email => 
                        !email.toLowerCase().includes('arbeitsagentur') &&
                        !email.toLowerCase().includes('example') &&
                        !email.toLowerCase().includes('noreply')
                    );
                    contactInfo.email = filteredEmails[0] || null;
                }

                // Extract phone numbers
                const phoneRegex = /(?:\+49|0049|0)\s?[1-9]\d{1,4}\s?\d{1,8}(?:[\s\-]?\d{1,8})?/g;
                const phones = pageText.match(phoneRegex);
                if (phones && phones.length > 0) {
                    contactInfo.phone = phones[0];
                }

                // Extract websites
                const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
                const urls = pageText.match(urlRegex);
                if (urls && urls.length > 0) {
                    const filteredUrls = urls.filter(url => 
                        !url.toLowerCase().includes('arbeitsagentur') &&
                        !url.toLowerCase().includes('xing') &&
                        !url.toLowerCase().includes('linkedin')
                    );
                    contactInfo.website = filteredUrls[0] || null;
                }

                // Application information
                const applicationInfo = {
                    applicationUrl: null,
                    applicationEmail: contactInfo.email,
                    applicationInstructions: null
                };

                // Look for application links
                const applicationLinks = document.querySelectorAll('a[href*="bewerben"], a[href*="application"], a[href*="apply"]');
                if (applicationLinks.length > 0) {
                    applicationInfo.applicationUrl = applicationLinks[0].href;
                }

                // Job metadata
                const jobType = extractText('[data-testid="job-type"]') || 
                              extractText('.job-type') ||
                              (pageText.includes('Vollzeit') ? 'Vollzeit' : 
                               pageText.includes('Teilzeit') ? 'Teilzeit' : null);

                const contractType = extractText('[data-testid="contract-type"]') || 
                                   extractText('.contract-type') ||
                                   (pageText.includes('unbefristet') ? 'unbefristet' : 
                                    pageText.includes('befristet') ? 'befristet' : null);

                // Additional details
                const benefits = extractAllText('.job-benefits li, .benefits li');
                const skills = extractAllText('.job-skills li, .skills li, .requirements li');

                return {
                    title,
                    company,
                    location,
                    description,
                    requirements,
                    contactInfo,
                    applicationInfo,
                    jobType,
                    contractType,
                    benefits,
                    skills,
                    rawText: pageText,
                    scrapedAt: new Date().toISOString(),
                    url: window.location.href
                };
            });

            // Process and clean the extracted data
            const processedDetails = this.processJobDetails(jobDetails, referenceNumber);
            
            console.log(`✅ Successfully scraped job details for: ${referenceNumber}`);
            return processedDetails;

        } catch (error) {
            console.error(`❌ Failed to scrape job details for ${referenceNumber}:`, error.message);
            return {
                referenceNumber,
                error: error.message,
                scrapedAt: new Date().toISOString(),
                url
            };
        }
    }

    /**
     * Process and enhance the scraped job details
     * @param {Object} details - Raw scraped details
     * @param {string} referenceNumber - Job reference number
     * @returns {Object} - Processed job details
     */
    processJobDetails(details, referenceNumber) {
        return {
            referenceNumber,
            title: details.title || 'No title found',
            company: details.company || 'Company not specified',
            location: details.location || 'Location not specified',
            description: this.cleanText(details.description),
            requirements: this.cleanText(details.requirements),
            
            contact: {
                email: details.contactInfo.email,
                phone: this.cleanPhoneNumber(details.contactInfo.phone),
                website: this.cleanUrl(details.contactInfo.website),
                person: details.contactInfo.contactPerson
            },
            
            application: {
                url: details.applicationInfo.applicationUrl,
                email: details.applicationInfo.applicationEmail,
                instructions: details.applicationInfo.applicationInstructions
            },
            
            jobDetails: {
                type: details.jobType,
                contractType: details.contractType,
                benefits: details.benefits || [],
                skills: details.skills || []
            },
            
            metadata: {
                scrapedAt: details.scrapedAt,
                sourceUrl: details.url,
                hasContact: !!(details.contactInfo.email || details.contactInfo.phone || details.contactInfo.website),
                textLength: details.rawText ? details.rawText.length : 0
            }
        };
    }

    /**
     * Clean and normalize text content
     * @param {string} text - Raw text
     * @returns {string} - Cleaned text
     */
    cleanText(text) {
        if (!text) return null;
        
        return text
            .replace(/\s+/g, ' ')  // Multiple spaces to single space
            .replace(/\n+/g, '\n') // Multiple newlines to single newline
            .trim();
    }

    /**
     * Clean and format phone number
     * @param {string} phone - Raw phone number
     * @returns {string} - Cleaned phone number
     */
    cleanPhoneNumber(phone) {
        if (!phone) return null;
        
        return phone
            .replace(/[^\d\+\(\)\-\s]/g, '')
            .trim();
    }

    /**
     * Clean and validate URL
     * @param {string} url - Raw URL
     * @returns {string} - Cleaned URL
     */
    cleanUrl(url) {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            return urlObj.toString();
        } catch {
            return url.trim();
        }
    }

    /**
     * Scrape multiple jobs in batch
     * @param {Array} referenceNumbers - Array of reference numbers
     * @param {number} delay - Delay between requests in ms
     * @returns {Promise<Array>} - Array of job details
     */
    async scrapeMultipleJobs(referenceNumbers, delay = 2000) {
        const results = [];
        
        for (let i = 0; i < referenceNumbers.length; i++) {
            const refNumber = referenceNumbers[i];
            console.log(`📋 Processing job ${i + 1}/${referenceNumbers.length}: ${refNumber}`);
            
            try {
                const details = await this.scrapeJobDetails(refNumber);
                results.push(details);
                
                // Add delay to avoid being blocked
                if (i < referenceNumbers.length - 1) {
                    console.log(`⏳ Waiting ${delay}ms before next request...`);
                    await this.delay(delay);
                }
                
            } catch (error) {
                console.error(`❌ Failed to process ${refNumber}:`, error.message);
                results.push({
                    referenceNumber: refNumber,
                    error: error.message,
                    scrapedAt: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Utility function for delays
     * @param {number} ms - Milliseconds to wait
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * CAPTCHA detection and image capture - with proactive triggering
     * @returns {Promise<Object>} - Result with success status and image info
     */
    async solveCaptcha() {
        const maxRetries = 3; // Maximum number of CAPTCHA solving attempts
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔍 CAPTCHA solving attempt ${attempt}/${maxRetries}...`);
                
                // Wait for page to load
                console.log('⏳ Waiting for page to fully load...');
                await this.delay(2000);
                
                // Check if CAPTCHA field exists
                console.log('📄 Checking for CAPTCHA input field...');
                const captchaFieldExists = await this.page.$('#kontaktdaten-captcha-input') !== null;
                console.log(`📝 CAPTCHA field exists: ${captchaFieldExists}`);
                
                if (!captchaFieldExists) {
                    console.log('ℹ️ No CAPTCHA field found - proceeding without CAPTCHA solving');
                    return { success: true, content: 'No CAPTCHA field found' };
                }

                console.log('🎯 CAPTCHA detected! Looking for CAPTCHA image...');
                
                const result = await this.solveCaptchaAttempt();
                
                if (result.success) {
                    console.log(`✅ CAPTCHA solved successfully on attempt ${attempt}!`);
                    return result;
                } else if (result.canRetry && attempt < maxRetries) {
                    console.log(`❌ CAPTCHA failed on attempt ${attempt}, retrying...`);
                    console.log('🔄 Waiting before next attempt and looking for new CAPTCHA image...');
                    await this.delay(2000);
                    continue; // Try again with new CAPTCHA
                } else {
                    console.log(`❌ CAPTCHA solving failed after ${attempt} attempts`);
                    return result;
                }
                
            } catch (error) {
                console.error(`❌ CAPTCHA attempt ${attempt} failed:`, error.message);
                if (attempt === maxRetries) {
                    return { success: false, error: error.message };
                }
                await this.delay(2000);
            }
        }
        
        return { success: false, error: 'Max CAPTCHA attempts exceeded' };
    }

    /**
     * Single CAPTCHA solving attempt
     * @returns {Promise<Object>} - Result with success status
     */
    async solveCaptchaAttempt() {
        try {

            // Scroll to CAPTCHA area using your exact method
            console.log('📜 Scrolling to CAPTCHA area...');
            await this.page.evaluate(() => {
                var element = document.querySelector('#kontaktdaten-captcha-input'); 
                if(element) {
                    element.scrollIntoView({behavior: 'smooth',block: 'end',inline: 'nearest'});
                    // Add a temporary highlight to show we found it
                    element.style.border = '3px solid red';
                    element.style.backgroundColor = 'yellow';
                    element.style.padding = '5px';
                }
            });

            await this.delay(2000);
            
            // Scroll up 20 pixels after finding CAPTCHA field
            console.log('📜 Adjusting scroll position up by 20px...');
            await this.page.evaluate(() => {
                window.scrollBy(0, -20);
            });

            await this.delay(2000); // Wait to see the adjusted position

            // Find CAPTCHA image with multiple selectors
            const captchaSelectors = [
                'img[src*="captcha"]',
                'img[src*="idaas"]', 
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
                return { success: false, error: 'CAPTCHA image not found' };
            }

            // Search for the actual CAPTCHA image URL in DOM
            console.log('🔍 Searching DOM for idaas/id-aas-service URL...');
            const captchaImageUrl = await this.page.evaluate(() => {
                // Search for elements containing idaas/id-aas-service
                const allElements = document.querySelectorAll('*');
                for (let element of allElements) {
                    // Check src attribute
                    if (element.src && element.src.includes('idaas/id-aas-service') && element.src.includes('image')) {
                        console.log('Found CAPTCHA image URL:', element.src);
                        return element.src;
                    }
                    // Check data attributes
                    for (let attr of element.attributes) {
                        if (attr.value && attr.value.includes('idaas/id-aas-service') && attr.value.includes('image')) {
                            console.log('Found CAPTCHA image URL in attribute:', attr.name, attr.value);
                            return attr.value;
                        }
                    }
                }
                return null;
            });
            
            console.log(`🔗 CAPTCHA image URL found: ${captchaImageUrl}`);
            
            if (!captchaImageUrl) {
                console.log('❌ Could not find CAPTCHA image URL in DOM');
                return { success: false, error: 'CAPTCHA image URL not found' };
            }
            
            // Solve CAPTCHA using independent solver
            console.log('🧩 Solving CAPTCHA using independent solver...');
            const solutionResult = await this.captchaSolver.solveCaptchaFromUrl(captchaImageUrl);
            
            if (!solutionResult.success) {
                console.log(`❌ Independent CAPTCHA solving failed: ${solutionResult.error}`);
                
                // Fallback to Odoo endpoint if configured
                if (this.useOdooEndpoint) {
                    console.log('🔄 Falling back to Odoo endpoint...');
                    const fallbackResult = await this.solveCaptchaViaOdoo(captchaImageUrl);
                    if (fallbackResult) {
                        var solution = fallbackResult;
                    } else {
                        return { success: false, error: 'Both independent and Odoo CAPTCHA solving failed' };
                    }
                } else {
                    return { success: false, error: solutionResult.error };
                }
            } else {
                var solution = solutionResult.solution;
                console.log(`✅ Independent CAPTCHA solved: ${solution} (Duration: ${solutionResult.duration}ms)`);
            }
            
            if (solution && solution.length >= 4) {
                console.log(`🧩 CAPTCHA solution received: ${solution}`);
                
                // Try to enter the solution - using proper JavaScript event simulation
                try {
                    console.log(`🔤 Entering CAPTCHA solution: '${solution}' into input field...`);
                    
                    // Wait for input field to be visible
                    await this.page.waitForSelector('#kontaktdaten-captcha-input', { timeout: 5000 });
                    console.log('✅ CAPTCHA input field found');
                    
                    // Scroll to the input field using your exact method
                    console.log('📜 Scrolling CAPTCHA field into view...');
                    await this.page.evaluate(() => {
                        var element = document.querySelector('#kontaktdaten-captcha-input'); 
                        if(element) {
                            element.scrollIntoView({behavior: 'smooth',block: 'end',inline: 'nearest'});
                            // Highlight the field so it's clearly visible
                            element.style.border = '5px solid red';
                            element.style.backgroundColor = 'yellow';
                            element.style.padding = '8px';
                            element.style.fontSize = '16px';
                        }
                    });
                    await this.delay(1000);
                    
                    // Scroll up 20 pixels after highlighting
                    console.log('📜 Adjusting scroll position up by 20px...');
                    await this.page.evaluate(() => {
                        window.scrollBy(0, -20);
                    });
                    await this.delay(1000); // Wait to see the field properly positioned
                    
                    // About to paste CAPTCHA solution
                    console.log(`🔤 About to paste CAPTCHA solution: "${solution}"`);
                    
                    // Use your suggested approach - set value and dispatch events
                    await this.page.evaluate((captchaSolution) => {
                        // Get the CAPTCHA input element
                        var captchaInput = document.getElementById('kontaktdaten-captcha-input');
                        
                        if (captchaInput) {
                            // Clear existing value
                            captchaInput.value = '';
                            
                            // Set the new value
                            captchaInput.value = captchaSolution;
                            
                            // Dispatch multiple events to ensure proper detection
                            var inputEvent = new Event('input', {
                                bubbles: true,
                                cancelable: true,
                            });
                            captchaInput.dispatchEvent(inputEvent);
                            
                            var changeEvent = new Event('change', {
                                bubbles: true,
                                cancelable: true,
                            });
                            captchaInput.dispatchEvent(changeEvent);
                            
                            // Also trigger focus and blur for completeness
                            captchaInput.focus();
                            captchaInput.blur();
                            
                            console.log('CAPTCHA solution entered:', captchaSolution);
                            
                        } else {
                            console.error('CAPTCHA input field not found!');
                        }
                    }, solution);
                    
                    console.log('🔤 CAPTCHA solution entered, waiting before clicking submit...');
                    await this.delay(2000); // Wait to see the value in the field
                    
                    // Click submit button using your method
                    console.log('🔘 Looking for submit button and clicking...');
                    const clicked = await this.page.evaluate(() => {
                        var element = document.querySelector('#kontaktdaten-captcha-absenden-button');
                        if (element) {
                            // Highlight submit button before clicking
                            element.style.border = '3px solid blue';
                            element.style.backgroundColor = 'lightblue';
                            element.click();
                            return true;
                        }
                        return false;
                    });
                    
                    if (clicked) {
                        console.log('✅ Submit button clicked successfully');
                    } else {
                        console.log('❌ Submit button not found or not clickable');
                    }
                    
                    console.log('⏳ Waiting for CAPTCHA validation...');
                    await this.delay(3000); // Wait for validation
                    
                    // Check if CAPTCHA was solved (with timeout protection)
                    console.log('🔍 Checking if CAPTCHA validation completed...');
                    let newBodyText;
                    try {
                        newBodyText = await Promise.race([
                            this.page.$eval('body', el => el.textContent),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                        ]);
                    } catch (error) {
                        console.log('⚠️ Page evaluation timeout - assuming CAPTCHA solved');
                        return { success: true, content: 'CAPTCHA solved (page timeout)' };
                    }
                    if (!newBodyText.includes('sicherheitsabfrage')) {
                        console.log('✅ CAPTCHA solved successfully! Continuing with page content...');
                        return { success: true, content: newBodyText };
                    } else {
                        console.log('❌ CAPTCHA solution was incorrect, still seeing security check');
                        console.log('🔄 Checking if we should retry or continue...');
                        
                        // Check if there's still a CAPTCHA field visible for retry
                        const captchaStillVisible = await this.page.$('#kontaktdaten-captcha-input') !== null;
                        if (captchaStillVisible) {
                            console.log('🔄 CAPTCHA field still visible - can retry with new image');
                            return { success: false, error: 'CAPTCHA solution incorrect', canRetry: true };
                        } else {
                            console.log('⚠️ CAPTCHA field no longer visible - continuing anyway');
                            return { success: true, content: newBodyText, note: 'CAPTCHA field disappeared' };
                        }
                    }
                } catch (error) {
                    console.error('❌ Error entering CAPTCHA solution:', error.message);
                    return { success: false, error: 'Failed to enter CAPTCHA solution' };
                }
            } else {
                console.log('❌ No valid CAPTCHA solution received');
                return { success: false, error: 'No CAPTCHA solution' };
            }

        } catch (error) {
            console.error(`❌ CAPTCHA processing failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Fallback: Solve CAPTCHA via Odoo endpoint (for backward compatibility)
     * @param {string} captchaImageUrl - URL of the CAPTCHA image
     * @returns {Promise<string>} - CAPTCHA solution
     */
    async solveCaptchaViaOdoo(captchaImageUrl) {
        try {
            console.log('📥 Downloading CAPTCHA for Odoo endpoint...');
            const axios = require('axios');
            const imageResponse = await axios.get(captchaImageUrl, { 
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            const imageBuffer = Buffer.from(imageResponse.data);
            const timestamp = Math.floor(Date.now() / 1000);
            const imageName = `${timestamp}.jpg`;
            const imagePath = `/Users/thomassee/Docker/containers/largeTables/mnt/extra-addons/captcha/${imageName}`;
            
            const fs = require('fs').promises;
            const path = require('path');
            
            // Ensure directory exists
            await fs.mkdir(path.dirname(imagePath), { recursive: true });
            
            // Save the downloaded image
            await fs.writeFile(imagePath, imageBuffer);
            console.log(`📸 CAPTCHA image saved for Odoo: ${imagePath}`);

            return await this.solveCaptchaWithOdooAPI(imageName);
            
        } catch (error) {
            console.error('❌ Odoo fallback failed:', error.message);
            return null;
        }
    }

    /**
     * Solve CAPTCHA using Odoo API endpoint (legacy method)
     * @param {string} imageName - Name of the image file
     * @returns {Promise<string>} - CAPTCHA solution
     */
    async solveCaptchaWithOdooAPI(imageName) {
        try {
            console.log(`🔧 Calling CAPTCHA API with image: ${imageName}`);
            
            const axios = require('axios');
            const response = await axios.post('https://thomas.dasschwarmprinzip.de/solve/captcha', {
                image: imageName
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': 'session_id=52d4b6ba7e07c0ad55e04e4dafacaf59a2647a7c'
                },
                timeout: 15000
            });

            console.log('🔧 CAPTCHA API response:', response.data);
            
            // Extract solution from response - handle the format: {'captchaId': '79751441793', 'code': 'czpKzn'}
            if (response.data && response.data.code) {
                console.log(`✅ CAPTCHA solution found: ${response.data.code} (ID: ${response.data.captchaId || 'unknown'})`);
                return response.data.code; // Return only the code value
            } else if (response.data && response.data.solution) {
                return response.data.solution;
            } else if (response.data && typeof response.data === 'string') {
                // Try to extract code from string format like "{'captchaId': '79751601584', 'code': 'vtFaAk'}"
                const codeMatch = response.data.match(/'code':\s*'([^']+)'/);
                if (codeMatch && codeMatch[1]) {
                    console.log(`✅ CAPTCHA code extracted from string: ${codeMatch[1]}`);
                    return codeMatch[1];
                }
                return response.data;
            } else {
                console.log('⚠️ Unexpected API response format:', response.data);
                return null;
            }
            
        } catch (error) {
            console.error('❌ CAPTCHA API call failed:', error.message);
            if (error.response) {
                console.error('API Response:', error.response.status, error.response.data);
            }
            return null;
        }
    }

    /**
     * Close the browser and cleanup
     */
    async cleanup() {
        try {
            if (this.page) {
                await this.page.close();
            }
            if (this.browser) {
                await this.browser.close();
            }
            this.isInitialized = false;
            console.log('🧹 Browser cleanup completed');
        } catch (error) {
            console.error('❌ Cleanup error:', error);
        }
    }
}

module.exports = JobDetailScraper;