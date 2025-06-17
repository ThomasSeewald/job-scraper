const cheerio = require('cheerio');

class ImprovedEmailExtractor {
    constructor() {
        this.unwantedPatterns = [
            'arbeitsagentur', 'webmaster', 'datenschutz', 'privacy',
            'noreply', 'no-reply', 'example.com', 'test.com',
            '.jpg', '.jpeg', '.png', '.gif', '.css', '.js',
            'wixpress', 'google.com', 'facebook.com'
        ];
    }

    extractEmails(html) {
        if (!html) return { emails: '', emailCount: 0 };

        const $ = cheerio.load(html);
        
        // Step 1: Get ALL text content (including scripts/styles initially)
        let fullText = $.html();
        
        // Step 2: Replace < and > with line breaks to separate tag content
        fullText = fullText.replace(/[<>]/g, '\n');
        
        // Step 3: Normalize common obfuscations
        fullText = this.normalizeObfuscations(fullText);
        
        // Step 4: Extract all @-containing tokens
        const tokens = fullText.split(/[\s\n\r\t]+/);
        const emailCandidates = tokens.filter(token => 
            token.includes('@') && token.length > 3
        );
        
        // Step 5: Clean up candidates with lenient validation
        const emails = [];
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        
        for (let candidate of emailCandidates) {
            // Try to extract valid email portion from messy string
            const match = candidate.match(emailRegex);
            if (match) {
                let email = match[1].toLowerCase();
                
                // Clean up common suffixes (from current implementation)
                email = this.cleanEmailSuffixes(email);
                
                // Basic filtering
                const isUnwanted = this.unwantedPatterns.some(pattern => 
                    email.includes(pattern)
                );
                
                if (!isUnwanted && !emails.includes(email)) {
                    emails.push(email);
                }
            }
        }
        
        // Step 6: Also check traditional mailto links
        $('a[href^="mailto:"]').each((i, elem) => {
            const href = $(elem).attr('href');
            const email = href.replace('mailto:', '').split('?')[0].toLowerCase();
            if (!emails.includes(email)) {
                emails.push(email);
            }
        });
        
        return {
            emails: emails.join(', '),
            emailCount: emails.length,
            candidates: emailCandidates.length // For debugging
        };
    }
    
    normalizeObfuscations(text) {
        return text
            // Common @ replacements
            .replace(/\(at\)/gi, '@')
            .replace(/\[at\]/gi, '@')
            .replace(/\{at\}/gi, '@')
            .replace(/\s+at\s+/gi, '@')
            .replace(/\s*@\s*/g, '@') // Remove spaces around @
            
            // Common . replacements
            .replace(/\(dot\)/gi, '.')
            .replace(/\[dot\]/gi, '.')
            .replace(/\{dot\}/gi, '.')
            .replace(/\s+dot\s+/gi, '.')
            .replace(/\s*\.\s*/g, '.') // Remove spaces around .
            
            // German-specific
            .replace(/\(punkt\)/gi, '.')
            .replace(/\[punkt\]/gi, '.')
            
            // Remove zero-width spaces and other Unicode tricks
            .replace(/[\u200B-\u200D\uFEFF]/g, '');
    }
    
    cleanEmailSuffixes(email) {
        // Common German suffixes that get concatenated
        const suffixes = [
            'kontaktaufnahme', 'nachricht', 'bewerbung', 'karriere',
            'jobs', 'stellenangebot', 'anzeige', 'info', 'mail', 'email',
            'kontakt', 'impressum', 'datenschutz'
        ];
        
        for (const suffix of suffixes) {
            const regex = new RegExp(`\\.(com|de|net|org|ch|at)${suffix}.*$`, 'i');
            email = email.replace(regex, '.$1');
        }
        
        return email;
    }
}

// Test the improved approach
const extractor = new ImprovedEmailExtractor();

// Test cases
const testCases = [
    '<div>Contact: info@company.de</div>Kontakt',
    'Email: user(at)domain.de or admin[at]domain[dot]com',
    '<script>var email = "hidden@inscript.de";</script>',
    'Reach us at: support @ company . de',
    'info@company.dekontaktaufnahme'
];

console.log('Testing improved email extraction:\n');
testCases.forEach(test => {
    console.log(`Input: ${test}`);
    const result = extractor.extractEmails(test);
    console.log(`Found: ${result.emails} (${result.emailCount} emails from ${result.candidates} candidates)\n`);
});

module.exports = ImprovedEmailExtractor;