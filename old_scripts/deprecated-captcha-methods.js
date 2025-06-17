/**
 * DEPRECATED CAPTCHA METHODS
 * 
 * This file contains deprecated buffer-based CAPTCHA solving methods that were
 * replaced with URL-based methods. Kept for reference purposes only.
 * 
 * Date archived: January 6, 2025
 * Reason: User feedback - "Image buffer is not the way. You have to extract the image out of the html-source"
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');

class DeprecatedCaptchaMethods {
    constructor(apiKey = null) {
        this.apiKey = apiKey || process.env.CAPTCHA_API_KEY || '2946675bf95f4081c1941d7a5f4141b6';
        this.baseURL = 'http://2captcha.com';
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
        this.timeout = 120000; // 2 minutes for CAPTCHA solving
        this.saveDirectory = process.env.CAPTCHA_SAVE_DIR || '/tmp/captcha';
    }

    /**
     * DEPRECATED: Solve CAPTCHA from image buffer
     * @param {Buffer} imageBuffer - Image buffer containing CAPTCHA
     * @param {string} filename - Optional filename for saving (for debugging)
     * @returns {Promise<Object>} - Result with success status and solution
     */
    async solveCaptchaFromBuffer(imageBuffer, filename = null) {
        const startTime = Date.now();
        
        try {
            console.log('🧩 Starting independent CAPTCHA solving...');
            
            // Optionally save image for debugging
            if (filename && process.env.CAPTCHA_SAVE_IMAGES === 'true') {
                await this.saveImageForDebugging(imageBuffer, filename);
            }

            // Solve CAPTCHA using raw HTTP API with retries
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    console.log(`🔄 CAPTCHA solving attempt ${attempt}/${this.maxRetries}...`);
                    
                    // Submit CAPTCHA
                    const captchaId = await this.submitCaptchaFromBuffer(imageBuffer);
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
                        duration: duration,
                        attempt: attempt
                    };
                    
                } catch (error) {
                    const duration = Date.now() - startTime;
                    console.log(`❌ CAPTCHA attempt ${attempt} failed after ${duration}ms: ${error.message}`);
                    
                    // Check if it's a specific 2captcha error
                    if (this.isRetryableError(error)) {
                        if (attempt < this.maxRetries) {
                            console.log(`🔄 Retrying in ${this.retryDelay}ms...`);
                            await this.delay(this.retryDelay);
                            continue;
                        }
                    } else {
                        // Non-retryable error, fail immediately
                        return {
                            success: false,
                            error: error.message,
                            errorCode: error.code || 'UNKNOWN',
                            duration: duration,
                            attempt: attempt
                        };
                    }
                }
            }
            
            // All attempts failed
            const duration = Date.now() - startTime;
            return {
                success: false,
                error: 'All CAPTCHA solving attempts failed',
                duration: duration,
                attempts: this.maxRetries
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('❌ Critical error in CAPTCHA solving:', error.message);
            return {
                success: false,
                error: error.message,
                duration: duration
            };
        }
    }

    /**
     * DEPRECATED: Submit CAPTCHA buffer to 2captcha API
     */
    async submitCaptchaFromBuffer(imageBuffer) {
        const tempFile = path.join(this.saveDirectory, `captcha_${Date.now()}.png`);
        
        try {
            // Ensure directory exists
            await fs.mkdir(this.saveDirectory, { recursive: true });
            
            // Save buffer to temporary file
            await fs.writeFile(tempFile, imageBuffer);
            
            // Create form data
            const formData = new FormData();
            formData.append('key', this.apiKey);
            formData.append('method', 'post');
            formData.append('file', require('fs').createReadStream(tempFile));
            
            const response = await axios.post(`${this.baseURL}/in.php`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            if (response.data.startsWith('OK|')) {
                const captchaId = response.data.split('|')[1];
                return captchaId;
            } else {
                throw new Error(`Submit failed: ${response.data}`);
            }
            
        } finally {
            // Clean up temporary file
            try {
                await fs.unlink(tempFile);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * DEPRECATED: Poll for CAPTCHA solution (used by buffer methods)
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
     * Check if an error is retryable
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
     * Save image for debugging purposes
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
     * Utility delay function
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = DeprecatedCaptchaMethods;