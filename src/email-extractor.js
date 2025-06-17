/**
 * Email Extractor using the "@-words first" approach
 * 
 * Strategy:
 * 1. Normalize obfuscations first
 * 2. Extract all @-containing words  
 * 3. Apply regex validation to clean each word
 * 4. Filter unwanted patterns
 * 
 * This approach significantly improves email extraction from messy HTML
 * and handles anti-scraping techniques much better than regex-first approaches.
 */

const cheerio = require('cheerio');

class EmailExtractor {
    constructor() {
        this.unwantedPatterns = [
            'arbeitsagentur', 'webmaster', 'datenschutz', 'privacy',
            'noreply', 'no-reply', 'example.com', 'test.com',
            '.jpg', '.jpeg', '.png', '.gif', '.css', '.js',
            'wixpress', 'google.com', 'facebook.com', 'linkedin.com', 'xing.com'
        ];
        
        this.germanSuffixes = [
            'kontaktaufnahme', 'nachricht', 'bewerbung', 'karriere',
            'jobs', 'stellenangebot', 'anzeige', 'info', 'mail', 
            'email', 'kontakt', 'impressum', 'datenschutz'
        ];
    }

    /**
     * Extract all valid emails from HTML content
     * @param {string} html - The HTML content to extract emails from
     * @param {string} jobTitle - Job title for context (optional)
     * @param {string} companyName - Company name for context (optional)
     * @returns {Object} - Object containing extracted emails and domain
     */
    extractEmails(html, jobTitle = '', companyName = '') {
        if (!html) {
            return {
                emails: '',
                domain: '',
                emailCount: 0
            };
        }

        // Step 1: Process HTML - break up tags but preserve content
        let text = html;
        
        // Replace < and > with spaces to separate tag content from text
        text = text.replace(/[<>]/g, ' ');
        
        // Step 2: Normalize ALL obfuscation patterns before word splitting
        text = this.normalizeAllObfuscations(text);
        
        // Step 3: Find all @-containing words (the key insight!)
        const words = text.split(/\s+/);
        const atWords = words.filter(word => 
            word.includes('@') && 
            word.length > 3 && 
            !word.match(/^[@\s]*$/) // Skip words that are just @ and spaces
        );
        
        // Step 4: Extract valid emails from each @-word using regex
        const emails = [];
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        
        for (const atWord of atWords) {
            // Clean punctuation from around the email
            const cleanWord = atWord.replace(/^[^\w@]+|[^\w.]+$/g, '');
            const match = cleanWord.match(emailRegex);
            
            if (match) {
                let email = match[1].toLowerCase();
                
                // Clean German suffixes
                email = this.cleanGermanSuffixes(email);
                
                // Filter unwanted patterns
                if (this.isValidEmail(email) && !emails.includes(email)) {
                    emails.push(email);
                }
            }
        }
        
        // Step 5: Also check for mailto links (traditional approach)
        try {
            const $ = cheerio.load(html);
            $('a[href^="mailto:"]').each((i, elem) => {
                const href = $(elem).attr('href');
                if (href) {
                    const email = href.replace('mailto:', '').split('?')[0].toLowerCase();
                    if (this.isValidEmail(email) && !emails.includes(email)) {
                        emails.push(email);
                    }
                }
            });
        } catch (error) {
            // Ignore cheerio parsing errors for malformed HTML
        }
        
        // Step 6: Extract application website links when no emails are found
        let applicationWebsite = '';
        if (emails.length === 0) {
            applicationWebsite = this.extractApplicationWebsite(html);
        }
        
        // Step 7: Prioritize emails if we have context
        const prioritizedEmails = this.prioritizeEmails(emails, companyName);
        
        // Extract domain from first valid email or application website
        let domain = '';
        if (prioritizedEmails.length > 0) {
            domain = this.extractDomain(prioritizedEmails[0]);
        } else if (applicationWebsite) {
            domain = this.extractDomainFromUrl(applicationWebsite);
        }
        
        return {
            emails: prioritizedEmails.join(', '),
            domain: domain,
            emailCount: prioritizedEmails.length,
            bestEmail: prioritizedEmails[0] || '',
            applicationWebsite: applicationWebsite || ''
        };
    }
    
    /**
     * Normalize all common email obfuscation patterns
     * @param {string} text - Text to normalize
     * @returns {string} - Normalized text
     */
    normalizeAllObfuscations(text) {
        return text
            // @ symbol replacements
            .replace(/\(at\)/gi, '@')
            .replace(/\[at\]/gi, '@')
            .replace(/\{at\}/gi, '@')
            .replace(/\s+at\s+/gi, '@')
            .replace(/\s*@\s*/g, '@') // Remove spaces around @
            
            // . (dot) replacements  
            .replace(/\(dot\)/gi, '.')
            .replace(/\[dot\]/gi, '.')
            .replace(/\{dot\}/gi, '.')
            .replace(/\s+dot\s+/gi, '.')
            .replace(/\(punkt\)/gi, '.') // German
            .replace(/\[punkt\]/gi, '.')
            
            // Handle spaced emails: "user @ domain . com" -> "user@domain.com"
            .replace(/(\w+)\s*@\s*(\w+(?:\s*\.\s*\w+)+)/g, (match, user, domain) => {
                return user + '@' + domain.replace(/\s+/g, '');
            })
            
            // Remove Unicode zero-width characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '');
    }
    
    /**
     * Clean German suffixes that get concatenated to emails
     * @param {string} email - Email to clean
     * @returns {string} - Cleaned email
     */
    cleanGermanSuffixes(email) {
        for (const suffix of this.germanSuffixes) {
            const regex = new RegExp(`\\.(com|de|net|org|ch|at)${suffix}.*$`, 'i');
            email = email.replace(regex, '.$1');
        }
        return email;
    }
    
    /**
     * Validate email and check against unwanted patterns
     * @param {string} email - Email to validate
     * @returns {boolean} - Whether email is valid
     */
    isValidEmail(email) {
        // Basic structure validation
        if (!email || !email.includes('@') || !email.includes('.')) {
            return false;
        }
        
        // Check for unwanted patterns
        const emailLower = email.toLowerCase();
        return !this.unwantedPatterns.some(pattern => 
            emailLower.includes(pattern.toLowerCase())
        );
    }
    
    /**
     * Prioritize emails based on relevance for job applications
     * @param {Array} emails - Array of email addresses
     * @param {string} companyName - Company name for context
     * @returns {Array} - Prioritized email addresses
     */
    prioritizeEmails(emails, companyName = '') {
        if (emails.length <= 1) return emails;
        
        // Score emails based on relevance
        const scored = emails.map(email => ({
            email,
            score: this.scoreEmail(email, companyName)
        }));
        
        // Sort by score (higher is better)
        scored.sort((a, b) => b.score - a.score);
        
        return scored.map(item => item.email);
    }
    
    /**
     * Score email based on job application relevance
     * @param {string} email - Email to score
     * @param {string} companyName - Company name for context
     * @returns {number} - Email relevance score
     */
    scoreEmail(email, companyName = '') {
        let score = 0;
        const emailLower = email.toLowerCase();
        
        // Prefer job-related emails
        if (emailLower.includes('bewerbung')) score += 10;
        if (emailLower.includes('karriere')) score += 10;
        if (emailLower.includes('jobs')) score += 8;
        if (emailLower.includes('hr')) score += 6;
        if (emailLower.includes('personal')) score += 6;
        
        // Prefer company domain if we know the company
        if (companyName && emailLower.includes(companyName.toLowerCase().replace(/\s+/g, ''))) {
            score += 15;
        }
        
        // Penalize generic emails
        if (emailLower.includes('info')) score -= 2;
        if (emailLower.includes('contact')) score -= 2;
        if (emailLower.includes('office')) score -= 1;
        
        return score;
    }
    
    /**
     * Extract domain from email address
     * @param {string} email - Email address
     * @returns {string} - Domain part of email
     */
    extractDomain(email) {
        if (!email || !email.includes('@')) return '';
        
        const domain = email.split('@')[1];
        return domain ? domain.toLowerCase() : '';
    }

    /**
     * Extract application website links when no email is found
     * @param {string} html - HTML content to search
     * @returns {string} - Application website URL or empty string
     */
    extractApplicationWebsite(html) {
        try {
            const $ = cheerio.load(html);
            
            // Look for German application instruction patterns
            const germanPatterns = [
                'über die internetseite des arbeitgebers',
                'bitte bewerben sie sich über die internetseite',
                'bewerben sie sich über die internetseite',
                'bewerben sie sich über',
                'weitere informationen und bewerbung',
                'bewerbung über die internetseite',
                'bewerbung über',
                'online-bewerbung',
                'hier bewerben',
                'jetzt bewerben',
                'internetseite des arbeitgebers',
                'website des arbeitgebers',
                'homepage des arbeitgebers'
            ];
            
            // Search for links near application text
            let applicationUrl = '';
            
            // First priority: Look for the specific application URL element
            const detailApplicationLink = $('#detail-bewerbung-url');
            if (detailApplicationLink.length > 0) {
                const href = detailApplicationLink.attr('href');
                if (href && (href.startsWith('http') || href.startsWith('www'))) {
                    applicationUrl = href;
                    console.log('🎯 Found direct application link via #detail-bewerbung-url');
                }
            }
            
            // Second priority: Look for "Über die Internetseite des Arbeitgebers" specifically
            if (!applicationUrl) {
                const pageText = $.html().toLowerCase();
                
                // Check if the key phrase exists
                if (pageText.includes('über die internetseite des arbeitgebers')) {
                    console.log('🎯 Found key phrase: "Über die Internetseite des Arbeitgebers"');
                    
                    // Look for links with this exact text
                    $('a[href]').each((i, elem) => {
                        const linkText = $(elem).text().toLowerCase();
                        if (linkText.includes('über die internetseite des arbeitgebers')) {
                            const href = $(elem).attr('href');
                            if (href && (href.startsWith('http') || href.startsWith('www'))) {
                                applicationUrl = href;
                                return false; // Take this link
                            }
                        }
                    });
                    
                    // If not found in link text, look for links in proximity to this phrase
                    if (!applicationUrl) {
                        $('*').each((i, elem) => {
                            const elemText = $(elem).text().toLowerCase();
                            if (elemText.includes('über die internetseite des arbeitgebers')) {
                                // Check this element and its siblings for links
                                $(elem).find('a[href]').each((j, linkElem) => {
                                    const href = $(linkElem).attr('href');
                                    if (href && (href.startsWith('http') || href.startsWith('www'))) {
                                        applicationUrl = href;
                                        return false; // Take first link found
                                    }
                                });
                                
                                // Also check parent and siblings
                                if (!applicationUrl) {
                                    $(elem).parent().find('a[href]').each((j, linkElem) => {
                                        const href = $(linkElem).attr('href');
                                        if (href && (href.startsWith('http') || href.startsWith('www'))) {
                                            applicationUrl = href;
                                            return false;
                                        }
                                    });
                                }
                                
                                if (applicationUrl) return false; // Found link, stop searching
                            }
                        });
                    }
                }
            }
            
            // Second priority: Check all links for application-related content
            if (!applicationUrl) {
                $('a[href]').each((i, elem) => {
                    const href = $(elem).attr('href');
                    const linkText = $(elem).text().toLowerCase();
                    const parentText = $(elem).parent().text().toLowerCase();
                    
                    if (href && (href.startsWith('http') || href.startsWith('www'))) {
                        // Check if link text or surrounding text matches patterns
                        const textToCheck = linkText + ' ' + parentText;
                        
                        for (const pattern of germanPatterns) {
                            if (textToCheck.includes(pattern)) {
                                applicationUrl = href;
                                break;
                            }
                        }
                        
                        // Also check for URLs that look like application/career pages
                        const urlLower = href.toLowerCase();
                        if (urlLower.includes('bewerbung') || 
                            urlLower.includes('karriere') || 
                            urlLower.includes('career') || 
                            urlLower.includes('jobs') ||
                            urlLower.includes('stellenanzeige')) {
                            applicationUrl = href;
                        }
                    }
                    
                    if (applicationUrl) return false; // Break out of loop
                });
            }
            
            // If no specific application link found, look for any external company website
            if (!applicationUrl) {
                $('a[href]').each((i, elem) => {
                    const href = $(elem).attr('href');
                    if (href && (href.startsWith('http') || href.startsWith('www'))) {
                        // Skip arbeitsagentur and common unwanted domains
                        const urlLower = href.toLowerCase();
                        if (!urlLower.includes('arbeitsagentur') &&
                            !urlLower.includes('google.com') &&
                            !urlLower.includes('facebook.com') &&
                            !urlLower.includes('linkedin.com') &&
                            !urlLower.includes('xing.com')) {
                            applicationUrl = href;
                            return false; // Take first valid external link
                        }
                    }
                });
            }
            
            // Clean and validate URL
            if (applicationUrl) {
                // Ensure URL has protocol
                if (applicationUrl.startsWith('www.')) {
                    applicationUrl = 'https://' + applicationUrl;
                }
                
                // Basic URL validation
                try {
                    new URL(applicationUrl);
                    return applicationUrl;
                } catch (error) {
                    return '';
                }
            }
            
            return '';
            
        } catch (error) {
            console.warn('Error extracting application website:', error.message);
            return '';
        }
    }

    /**
     * Extract domain from URL
     * @param {string} url - URL to extract domain from
     * @returns {string} - Domain part of URL
     */
    extractDomainFromUrl(url) {
        try {
            if (!url) return '';
            
            // Ensure URL has protocol
            if (!url.startsWith('http') && !url.startsWith('//')) {
                url = 'https://' + url;
            }
            
            const urlObj = new URL(url);
            return urlObj.hostname.toLowerCase().replace(/^www\./, '');
        } catch (error) {
            return '';
        }
    }

    /**
     * Extract emails with priority for job-related emails
     * @param {string} html - HTML content
     * @param {string} jobTitle - Job title for context
     * @param {string} companyName - Company name for context
     * @returns {Object} - Prioritized email extraction results
     */
    extractPrioritizedEmails(html, jobTitle = '', companyName = '') {
        const result = this.extractEmails(html, jobTitle, companyName);
        
        if (!result.emails) {
            return result;
        }

        const emailList = result.emails.split(', ');
        const prioritizedEmails = this.prioritizeEmails(emailList, companyName);
        
        return {
            ...result,
            emails: prioritizedEmails.join(', '),
            bestEmail: prioritizedEmails[0] || '',
            prioritizedList: prioritizedEmails
        };
    }

    // Legacy methods for backwards compatibility
    findAllEmails(text) {
        // Convert to new approach
        const result = this.extractEmails(text);
        return result.emails ? result.emails.split(', ') : [];
    }
    
    normalizeEmail(email) {
        return this.normalizeAllObfuscations(email);
    }
    
    filterAndCleanEmails(emails) {
        return emails.filter(email => this.isValidEmail(email));
    }
    
    cleanSingleEmail(email) {
        if (!email || typeof email !== 'string') return null;
        
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        const match = email.match(emailRegex);
        
        if (match) {
            let cleanEmail = match[1].toLowerCase();
            cleanEmail = this.cleanGermanSuffixes(cleanEmail);
            return this.isValidEmail(cleanEmail) ? cleanEmail : null;
        }
        
        return null;
    }
}

module.exports = EmailExtractor;