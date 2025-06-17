class AtWordsFirstExtractor {
    extractEmails(html) {
        if (!html) return { emails: '', emailCount: 0 };

        // Step 1: Get all text, replace < > with spaces to break up tags
        let text = html.replace(/[<>]/g, ' ');
        
        // Step 2: Normalize common obfuscations BEFORE splitting
        text = this.normalizeObfuscations(text);
        
        // Step 3: Split into words and find ALL @-containing words
        const words = text.split(/\s+/);
        const atWords = words.filter(word => word.includes('@'));
        
        console.log(`Found ${atWords.length} @-words:`, atWords.slice(0, 10)); // Debug
        
        // Step 4: NOW apply regex to clean and validate each @-word
        const emails = [];
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        
        for (const atWord of atWords) {
            const match = atWord.match(emailRegex);
            if (match) {
                let email = match[1].toLowerCase();
                email = this.cleanSuffix(email);
                
                if (this.isValidEmail(email) && !emails.includes(email)) {
                    emails.push(email);
                }
            }
        }
        
        return {
            emails: emails.join(', '),
            emailCount: emails.length,
            atWordsFound: atWords.length // For debugging
        };
    }
    
    normalizeObfuscations(text) {
        return text
            .replace(/\(at\)/gi, '@')
            .replace(/\[at\]/gi, '@')
            .replace(/\s+at\s+/gi, '@')
            .replace(/\(dot\)/gi, '.')
            .replace(/\[dot\]/gi, '.')
            .replace(/\s+dot\s+/gi, '.')
            // Handle spaced emails: "user @ domain . com"
            .replace(/(\w+)\s*@\s*(\w+(?:\s*\.\s*\w+)+)/g, (match, user, domain) => {
                return user + '@' + domain.replace(/\s+/g, '');
            });
    }
    
    cleanSuffix(email) {
        // Remove common German suffixes
        const suffixes = ['kontaktaufnahme', 'nachricht', 'bewerbung', 'karriere', 'kontakt'];
        for (const suffix of suffixes) {
            const regex = new RegExp(`\\.(com|de|net|org)${suffix}.*$`, 'i');
            email = email.replace(regex, '.$1');
        }
        return email;
    }
    
    isValidEmail(email) {
        // Basic validation + unwanted pattern filtering
        const unwantedPatterns = ['arbeitsagentur', 'webmaster', 'noreply', 'example.com'];
        return email.includes('@') && 
               email.includes('.') && 
               !unwantedPatterns.some(pattern => email.includes(pattern));
    }
}

// Test with challenging cases
const extractor = new AtWordsFirstExtractor();

const testCases = [
    // Messy HTML
    '<p>Contact: info@company.de</p>andhereissometext',
    
    // Spaced out
    'Email us at user @ domain . com for more info',
    
    // Multiple obfuscations  
    'Try user(at)domain.de or admin[at]company[dot]com',
    
    // JavaScript hidden
    '<script>var contact = "hidden@company.de";</script>',
    
    // Suffix contamination
    'Send to: jobs@company.dekontaktaufnahme',
    
    // Mixed spacing and obfuscation
    'Contact support (at) company . de or sales@company.com',
    
    // Real-world messy case
    'E-Mail:info@firma.de<br>oderrufenan:+491234567890'
];

console.log('=== Testing @-Words First Approach ===\n');

testCases.forEach((test, i) => {
    console.log(`Test ${i + 1}: ${test}`);
    const result = extractor.extractEmails(test);
    console.log(`Result: ${result.emails} (${result.emailCount} emails from ${result.atWordsFound} @-words)`);
    console.log('---');
});

module.exports = AtWordsFirstExtractor;