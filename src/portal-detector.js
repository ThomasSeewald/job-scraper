/**
 * Portal/Service Website Detector
 * 
 * Detects and categorizes websites to avoid scraping shared platforms
 * and job portals that don't contain direct employer contact information.
 */

class PortalDetector {
    constructor() {
        // Comprehensive list of portal patterns organized by category
        this.portalPatterns = {
            // Job portals and recruiting platforms
            jobPortals: [
                'stepstone.de', 'stepstone.com', 'stepstone.at', 'stepstone.ch',
                'indeed.com', 'indeed.de', 'indeed.at', 'indeed.ch',
                'xing.com', 'xing.de', 'kunxing.com',
                'linkedin.com', 'linkedin.de', 'career.linkedin.com',
                'monster.de', 'monster.com', 'monster.at', 'monster.ch',
                'jobware.de', 'jobware.com',
                'stellenanzeigen.de', 'jobs.de',
                'jobboerse.arbeitsagentur.de', 'arbeitsagentur.de',
                'karriere.at', 'jobs.at',
                'jobscout24.de', 'jobscout24.at', 'jobscout24.ch',
                'stellenwerk.de', 'stepstone-karriere.de',
                'jobvector.de', 'jobvector.com',
                'get-in-it.de', 'get-in-engineering.de',
                'academics.de', 'academics.com',
                'jobkanal.de', 'stellenportal.de',
                'meinestadt.de', 'kalaydo.de',
                'ebay-kleinanzeigen.de', 'quoka.de',
                'jobrapido.de', 'jooble.de', 'neuvoo.de',
                'glassdoor.de', 'glassdoor.com',
                'jobindex.dk', 'jobindex.de',
                'jobnet.dk', 'thelocal.de'
            ],
            
            // Social media platforms
            socialMedia: [
                'facebook.com', 'fb.com', 'instagram.com',
                'twitter.com', 'x.com', 'youtube.com',
                'tiktok.com', 'snapchat.com', 'pinterest.com',
                'whatsapp.com', 'telegram.org', 'discord.com',
                'reddit.com', 'tumblr.com', 'vk.com'
            ],
            
            // Review and rating platforms
            reviewPlatforms: [
                'kununu.com', 'kununu.de',
                'glassdoor.de', 'glassdoor.com',
                'bewertungsportal.de', 'golocal.de',
                'yelp.com', 'yelp.de', 'tripadvisor.de',
                'trustpilot.com', 'trustpilot.de',
                'proven-expert.com', 'provenexpert.com'
            ],
            
            // Generic platforms and services
            genericPlatforms: [
                'google.com', 'google.de', 'google.at', 'google.ch',
                'microsoft.com', 'apple.com', 'amazon.com',
                'wordpress.com', 'blogger.com', 'tumblr.com',
                'wix.com', 'squarespace.com', 'weebly.com',
                'jimdo.com', '1und1.de', 'strato.de',
                'github.com', 'gitlab.com', 'bitbucket.org',
                'stackoverflow.com', 'stackexchange.com'
            ],
            
            // News and media platforms
            mediaPlattforms: [
                'bild.de', 'spiegel.de', 'focus.de', 'zeit.de',
                'faz.net', 'sueddeutsche.de', 'tagesschau.de',
                'n-tv.de', 'rtl.de', 'sat1.de', 'prosieben.de',
                'cnn.com', 'bbc.com', 'reuters.com'
            ],
            
            // E-commerce platforms
            ecommercePlatforms: [
                'ebay.de', 'ebay.com', 'amazon.de', 'amazon.com',
                'otto.de', 'zalando.de', 'zalando.com',
                'alibaba.com', 'aliexpress.com',
                'idealo.de', 'preisvergleich.de'
            ],
            
            // Educational platforms
            educationalPlatforms: [
                'moodle.org', 'edx.org', 'coursera.org',
                'udemy.com', 'khan-academy.org',
                'wikipedia.org', 'wikipedia.de'
            ]
        };
        
        // Patterns that indicate legitimate company domains
        this.legitimatePatterns = [
            // Company-specific career page indicators
            '/karriere', '/career', '/jobs', '/stellenanzeigen',
            '/stellenausschreibung', '/bewerbung', '/recruitment',
            '/arbeiten-bei', '/working-at', '/join-us', '/team',
            
            // Company structure indicators
            '.gmbh', '.ag', '.kg', '.ohg', '.ug', '.ev',
            '.inc', '.corp', '.ltd', '.llc', '.co',
            
            // Domain extensions that suggest legitimate companies
            '.de', '.com', '.org', '.net', '.eu', '.at', '.ch'
        ];
        
        // Patterns that suggest portal/shared platforms
        this.portalIndicators = [
            '/job/', '/jobs/', '/stellenanzeige/', '/anzeige/',
            '/profile/', '/company/', '/unternehmen/',
            '/bewertung/', '/review/', '/rating/',
            '/portal/', '/platform/', '/service/'
        ];
    }

    /**
     * Detect if a URL/domain is a portal or service website
     * @param {string} url - URL or domain to check
     * @returns {Object} - Detection result with category and confidence
     */
    detectPortal(url) {
        if (!url) {
            return { isPortal: false, category: null, confidence: 0, reason: 'No URL provided' };
        }

        const urlLower = url.toLowerCase();
        
        // Check against all portal categories
        for (const [category, patterns] of Object.entries(this.portalPatterns)) {
            for (const pattern of patterns) {
                if (urlLower.includes(pattern)) {
                    return {
                        isPortal: true,
                        category: category,
                        confidence: 0.95,
                        reason: `Matches known ${category} pattern: ${pattern}`,
                        detectedPattern: pattern
                    };
                }
            }
        }
        
        // Check for portal URL structure indicators
        let portalIndicatorCount = 0;
        let detectedIndicators = [];
        
        for (const indicator of this.portalIndicators) {
            if (urlLower.includes(indicator)) {
                portalIndicatorCount++;
                detectedIndicators.push(indicator);
            }
        }
        
        // High portal indicator count suggests shared platform
        if (portalIndicatorCount >= 2) {
            return {
                isPortal: true,
                category: 'structuralPortal',
                confidence: 0.8,
                reason: `Multiple portal indicators detected: ${detectedIndicators.join(', ')}`,
                detectedIndicators: detectedIndicators
            };
        }
        
        // Check for legitimate company indicators
        let legitimateIndicatorCount = 0;
        let detectedLegitimate = [];
        
        for (const indicator of this.legitimatePatterns) {
            if (urlLower.includes(indicator)) {
                legitimateIndicatorCount++;
                detectedLegitimate.push(indicator);
            }
        }
        
        // Strong legitimate indicators suggest real company
        if (legitimateIndicatorCount >= 2 && portalIndicatorCount === 0) {
            return {
                isPortal: false,
                category: 'legitimateCompany',
                confidence: 0.9,
                reason: `Strong company indicators: ${detectedLegitimate.join(', ')}`,
                detectedIndicators: detectedLegitimate
            };
        }
        
        // Ambiguous cases - lean towards not portal unless clear evidence
        if (portalIndicatorCount === 1) {
            return {
                isPortal: true,
                category: 'possiblePortal',
                confidence: 0.6,
                reason: `Single portal indicator detected: ${detectedIndicators[0]}`,
                detectedIndicators: detectedIndicators
            };
        }
        
        // Default: assume legitimate company domain
        return {
            isPortal: false,
            category: 'unknownCompany',
            confidence: 0.7,
            reason: 'No clear portal indicators detected, assuming legitimate company',
            detectedIndicators: []
        };
    }

    /**
     * Check if a domain should be avoided for email extraction
     * @param {string} url - URL or domain to check
     * @param {number} minConfidence - Minimum confidence threshold (default: 0.8)
     * @returns {boolean} - True if domain should be avoided
     */
    shouldAvoidDomain(url, minConfidence = 0.8) {
        const detection = this.detectPortal(url);
        return detection.isPortal && detection.confidence >= minConfidence;
    }

    /**
     * Get a list of all known portal patterns
     * @returns {Array} - Flat array of all portal patterns
     */
    getAllPortalPatterns() {
        const allPatterns = [];
        for (const patterns of Object.values(this.portalPatterns)) {
            allPatterns.push(...patterns);
        }
        return allPatterns.sort();
    }

    /**
     * Categorize a URL based on its characteristics
     * @param {string} url - URL to categorize
     * @returns {Object} - Categorization result
     */
    categorizeUrl(url) {
        const detection = this.detectPortal(url);
        
        return {
            url: url,
            isPortal: detection.isPortal,
            category: detection.category,
            confidence: detection.confidence,
            recommendation: detection.isPortal ? 'AVOID' : 'PROCESS',
            reason: detection.reason,
            details: detection
        };
    }

    /**
     * Batch process multiple URLs for portal detection
     * @param {Array} urls - Array of URLs to check
     * @returns {Array} - Array of categorization results
     */
    batchDetect(urls) {
        return urls.map(url => this.categorizeUrl(url));
    }

    /**
     * Generate statistics for portal detection results
     * @param {Array} results - Array of detection results
     * @returns {Object} - Statistics summary
     */
    generateStats(results) {
        const stats = {
            total: results.length,
            portals: results.filter(r => r.isPortal).length,
            legitimate: results.filter(r => !r.isPortal).length,
            categories: {},
            recommendations: {
                AVOID: results.filter(r => r.recommendation === 'AVOID').length,
                PROCESS: results.filter(r => r.recommendation === 'PROCESS').length
            }
        };
        
        // Count by category
        results.forEach(result => {
            const category = result.category || 'unknown';
            stats.categories[category] = (stats.categories[category] || 0) + 1;
        });
        
        return stats;
    }
}

module.exports = PortalDetector;