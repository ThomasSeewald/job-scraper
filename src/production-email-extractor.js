/**
 * Production-Ready Email Extractor using the "@-words first" approach
 * 
 * Strategy:
 * 1. Normalize obfuscations first
 * 2. Extract all @-containing words  
 * 3. Apply regex validation to clean each word
 * 4. Filter unwanted patterns
 */

const cheerio = require('cheerio');

class ProductionEmailExtractor {
    constructor() {
        this.unwantedPatterns = [
            'arbeitsagentur', 'webmaster', 'datenschutz', 'privacy',
            'noreply', 'no-reply', 'example.com', 'test.com',
            '.jpg', '.jpeg', '.png', '.gif', '.css', '.js',
            'wixpress', 'google.com', 'facebook.com', 'linkedin.com'
        ];
        
        this.germanSuffixes = [
            'kontaktaufnahme', 'nachricht', 'bewerbung', 'karriere',
            'jobs', 'stellenangebot', 'anzeige', 'info', 'mail', 
            'email', 'kontakt', 'impressum', 'datenschutz'
        ];
    }

    extractEmails(html, jobTitle = '', companyName = '') {
        if (!html) {
            return { emails: '', emailCount: 0, debug: { atWords: 0 } };
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
        const $ = cheerio.load(html);
        $('a[href^="mailto:"]').each((i, elem) => {
            const href = $(elem).attr('href');
            const email = href.replace('mailto:', '').split('?')[0].toLowerCase();
            if (this.isValidEmail(email) && !emails.includes(email)) {
                emails.push(email);
            }
        });
        
        // Step 6: Prioritize emails if we have context
        const prioritizedEmails = this.prioritizeEmails(emails, companyName);
        
        return {
            emails: prioritizedEmails.join(', '),
            emailCount: prioritizedEmails.length,
            bestEmail: prioritizedEmails[0] || '',
            debug: {
                atWords: atWords.length,
                rawAtWords: atWords.slice(0, 5) // First 5 for debugging
            }
        };
    }
    
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
    
    cleanGermanSuffixes(email) {
        for (const suffix of this.germanSuffixes) {
            const regex = new RegExp(`\\.(com|de|net|org|ch|at)${suffix}.*$`, 'i');
            email = email.replace(regex, '.$1');
        }
        return email;
    }
    
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
        if (companyName && emailLower.includes(companyName.toLowerCase())) {
            score += 15;
        }
        
        // Penalize generic emails
        if (emailLower.includes('info')) score -= 2;
        if (emailLower.includes('contact')) score -= 2;
        if (emailLower.includes('office')) score -= 1;
        
        return score;
    }
}

module.exports = ProductionEmailExtractor;