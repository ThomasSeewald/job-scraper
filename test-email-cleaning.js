const EmailExtractor = require('./src/email-extractor');

function testEmailCleaning() {
    console.log('🧪 Testing email cleaning functionality...');
    
    const extractor = new EmailExtractor();
    
    // Test problematic emails we've encountered
    const testEmails = [
        '6090karriere@dieffenbacher-zaisenhausen.dekontaktaufnahmenachricht',
        'karriere@dieffenbacher-zaisenhausen.de',
        '+49123456789info@company.de',
        'bewerbung@example.comnachricht',
        'test@domain.dekontaktaufnahme',
        'jobs@company.orgstellenangebot',
        'normal@email.com',
        'invalid-email',
        '@invalid.com',
        'test@invalid',
        ''
    ];
    
    console.log('📧 Testing individual email cleaning:');
    testEmails.forEach(email => {
        const cleaned = extractor.cleanSingleEmail(email);
        console.log(`  "${email}" → "${cleaned}"`);
    });
    
    // Test full extraction
    const testHtml = `
        <div>
            Contact us at 6090karriere@dieffenbacher-zaisenhausen.dekontaktaufnahmenachricht
            or via bewerbung@example.comnachricht
            You can also reach us at normal@email.com
        </div>
    `;
    
    console.log('\n📄 Testing full HTML extraction:');
    const result = extractor.extractPrioritizedEmails(testHtml, 'Test Job', 'Test Company');
    console.log('Extracted emails:', result.emails);
    console.log('Best email:', result.bestEmail);
    console.log('Email count:', result.emailCount);
    console.log('Domain:', result.domain);
}

testEmailCleaning();