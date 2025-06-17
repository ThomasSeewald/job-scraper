const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');

class IndependentCaptchaSolver {
    constructor(apiKey = null) {
        this.apiKey = apiKey || process.env.CAPTCHA_API_KEY || '2946675bf95f4081c1941d7a5f4141b6';
        this.baseURL = 'http://2captcha.com';
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
        this.timeout = 120000; // 2 minutes for CAPTCHA solving
        this.saveDirectory = process.env.CAPTCHA_SAVE_DIR || '/tmp/captcha';
        
        console.log('🔧 Independent CAPTCHA Solver initialized');
        console.log(`📁 CAPTCHA save directory: ${this.saveDirectory}`);
    }


    /**
     * Poll for CAPTCHA solution
     */
    async pollForSolution(captchaId) {
        const maxPollingAttempts = 60; // 2 minutes max (60 * 2 seconds)
        let attempts = 0;
        
        while (attempts < maxPollingAttempts) {
            await this.delay(2000); // Wait 2 seconds between polls
            attempts++;
            
            const response = await axios.get(`${this.baseURL}/res.php`, {
                params: {
                    key: this.apiKey,
                    action: 'get',
                    id: captchaId
                }
            });
            
            if (response.data === 'CAPCHA_NOT_READY') {
                continue;
            } else if (response.data.startsWith('OK|')) {
                const solution = response.data.split('|')[1];
                return solution;
            } else {
                throw new Error(`Polling failed: ${response.data}`);
            }
        }
        
        throw new Error('Timeout waiting for CAPTCHA solution');
    }

    /**
     * Solve CAPTCHA from image URL
     * @param {string} imageUrl - URL of the CAPTCHA image
     * @returns {Promise<Object>} - Result with success status and solution
     */
    async solveCaptchaFromUrl(imageUrl) {
        const startTime = Date.now();
        
        try {
            console.log(`🌐 Downloading CAPTCHA from URL: ${imageUrl}`);
            
            const axios = require('axios');
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            const imageBuffer = Buffer.from(response.data);
            console.log(`📥 Downloaded CAPTCHA image (${imageBuffer.length} bytes)`);
            
            // Extract filename from URL for debugging
            const urlPath = new URL(imageUrl).pathname;
            const filename = path.basename(urlPath) || `captcha_${Date.now()}.jpg`;
            
            // Create a temporary file to submit to 2captcha
            const tempFile = path.join(this.saveDirectory, `captcha_${Date.now()}.png`);
            
            try {
                // Ensure directory exists
                await fs.mkdir(this.saveDirectory, { recursive: true });
                
                // Save buffer to temporary file
                await fs.writeFile(tempFile, imageBuffer);
                
                // Create form data
                const FormData = require('form-data');
                const formData = new FormData();
                formData.append('key', this.apiKey);
                formData.append('method', 'post');
                formData.append('file', require('fs').createReadStream(tempFile));
                
                const submitResponse = await axios.post(`${this.baseURL}/in.php`, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Content-Type': 'multipart/form-data'
                    }
                });
                
                if (!submitResponse.data.startsWith('OK|')) {
                    throw new Error(`Submit failed: ${submitResponse.data}`);
                }
                
                const captchaId = submitResponse.data.split('|')[1];
                console.log(`📤 CAPTCHA submitted with ID: ${captchaId}`);
                
                // Poll for result
                const solution = await this.pollForSolution(captchaId);
                
                const duration = Date.now() - startTime;
                console.log(`✅ CAPTCHA solved successfully in ${duration}ms: "${solution}" (ID: ${captchaId})`);
                
                return {
                    success: true,
                    text: solution,
                    solution: solution,
                    captchaId: captchaId,
                    duration: duration
                };
                
            } finally {
                // Clean up temporary file
                try {
                    await fs.unlink(tempFile);
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('❌ Failed to download CAPTCHA image:', error.message);
            return {
                success: false,
                error: `Failed to download image: ${error.message}`,
                duration: duration
            };
        }
    }

    /**
     * Solve CAPTCHA from file path
     * @param {string} imagePath - Path to the CAPTCHA image file
     * @returns {Promise<Object>} - Result with success status and solution
     */
    async solveCaptchaFromFile(imagePath) {
        try {
            console.log(`📁 Reading CAPTCHA from file: ${imagePath}`);
            
            const imageBuffer = await fs.readFile(imagePath);
            const filename = path.basename(imagePath);
            
            // We'll implement this if needed - for now just return error
            throw new Error('solveCaptchaFromFile not implemented after buffer method removal');
            
        } catch (error) {
            console.error('❌ Failed to read CAPTCHA file:', error.message);
            return {
                success: false,
                error: `Failed to read file: ${error.message}`
            };
        }
    }

    /**
     * Check if an error is retryable
     * @param {Error} error - The error to check
     * @returns {boolean} - Whether the error is retryable
     */
    isRetryableError(error) {
        const retryableErrors = [
            'ERROR_NO_SLOT_AVAILABLE',
            'ERROR_ZERO_CAPTCHA_FILESIZE',
            'ERROR_TOO_BIG_CAPTCHA_FILESIZE',
            'ERROR_IP_NOT_ALLOWED',
            'MAX_USER_TURN',
            'ERROR_BAD_TOKEN_OR_PAGEURL',
            'ERROR_PAGEURL',
            'CAPCHA_NOT_READY', // Common temporary error
            'timeout',
            'network'
        ];

        const errorMessage = error.message.toLowerCase();
        return retryableErrors.some(retryableError => 
            errorMessage.includes(retryableError.toLowerCase())
        );
    }

    /**
     * Get account balance
     * @returns {Promise<Object>} - Account balance information
     */
    async getBalance() {
        try {
            const response = await axios.get(`${this.baseURL}/res.php`, {
                params: {
                    key: this.apiKey,
                    action: 'getbalance'
                }
            });
            
            const balance = parseFloat(response.data);
            console.log(`💰 2Captcha account balance: $${balance}`);
            return {
                success: true,
                balance: balance
            };
        } catch (error) {
            console.error('❌ Failed to get account balance:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Report incorrect CAPTCHA solution
     * @param {string} captchaId - ID of the CAPTCHA to report
     * @returns {Promise<Object>} - Report result
     */
    async reportIncorrect(captchaId) {
        try {
            console.log(`📢 Reporting incorrect CAPTCHA solution: ${captchaId}`);
            await this.solver.reportIncorrect(captchaId);
            
            return {
                success: true,
                message: 'Incorrect solution reported successfully'
            };
        } catch (error) {
            console.error('❌ Failed to report incorrect solution:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Save image for debugging purposes
     * @param {Buffer} imageBuffer - Image buffer
     * @param {string} filename - Filename for the saved image
     */
    async saveImageForDebugging(imageBuffer, filename) {
        try {
            // Ensure save directory exists
            await fs.mkdir(this.saveDirectory, { recursive: true });
            
            const timestamp = Math.floor(Date.now() / 1000);
            const debugFilename = `${timestamp}_${filename}`;
            const debugPath = path.join(this.saveDirectory, debugFilename);
            
            await fs.writeFile(debugPath, imageBuffer);
            console.log(`💾 CAPTCHA image saved for debugging: ${debugPath}`);
            
        } catch (error) {
            console.warn('⚠️ Failed to save debug image:', error.message);
        }
    }

    /**
     * Get solver statistics
     * @returns {Object} - Current solver configuration and stats
     */
    getStats() {
        return {
            apiKey: this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'Not set',
            maxRetries: this.maxRetries,
            retryDelay: this.retryDelay,
            timeout: this.timeout,
            saveDirectory: this.saveDirectory,
            saveImages: process.env.CAPTCHA_SAVE_IMAGES === 'true'
        };
    }

    /**
     * Test the CAPTCHA solver with a simple test
     * @returns {Promise<Object>} - Test result
     */
    async test() {
        try {
            console.log('🧪 Testing CAPTCHA solver...');
            
            // Test balance first
            const balanceResult = await this.getBalance();
            if (!balanceResult.success) {
                return {
                    success: false,
                    error: 'Failed to connect to 2Captcha API',
                    details: balanceResult.error
                };
            }

            console.log('✅ CAPTCHA solver test passed');
            return {
                success: true,
                balance: balanceResult.balance,
                configuration: this.getStats()
            };
            
        } catch (error) {
            console.error('❌ CAPTCHA solver test failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Utility delay function
     * @param {number} ms - Milliseconds to wait
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = IndependentCaptchaSolver;