/**
 * Test script for portal detection functionality
 */

const PortalDetector = require('./src/portal-detector');

function testPortalDetection() {
    console.log('🧪 Testing Portal Detection System...');
    
    const detector = new PortalDetector();
    
    // Test URLs - mix of portals and legitimate companies
    const testUrls = [
        // Job portals (should be detected as portals)
        'https://www.stepstone.de/stellenangebote/softwareentwickler',
        'https://www.xing.com/jobs/muenchen-softwareentwickler',
        'https://www.linkedin.com/jobs/view/1234567890',
        'https://www.indeed.de/viewjob?jk=abcd1234',
        'https://jobs.arbeitsagentur.de/jobsuche/',
        
        // Social media (should be detected as portals)
        'https://www.facebook.com/company/careers',
        'https://twitter.com/company',
        'https://www.youtube.com/user/company',
        
        // Legitimate company websites (should NOT be detected as portals)
        'https://www.siemens.de/karriere',
        'https://careers.bmw.com/de/',
        'https://www.sap.com/germany/about/careers/',
        'https://jobs.mercedes-benz.com/',
        'https://www.bosch.de/karriere/',
        
        // Review platforms (should be detected as portals)
        'https://www.kununu.com/de/volkswagen',
        'https://www.glassdoor.de/Bewertungen/SAP-Bewertungen',
        
        // Ambiguous cases
        'https://company-recruiting.com/jobs',
        'https://www.beispiel-firma.de/stellenanzeigen',
        'https://www.test-company.de'
    ];
    
    console.log('\n📊 Portal Detection Results:');
    console.log('=' .repeat(80));
    
    const results = [];
    
    testUrls.forEach((url, index) => {
        const result = detector.categorizeUrl(url);
        results.push(result);
        
        const status = result.isPortal ? '🚫 PORTAL' : '✅ LEGITIMATE';
        const confidence = `(${(result.confidence * 100).toFixed(0)}%)`;
        
        console.log(`${index + 1}. ${status} ${confidence} - ${result.category}`);
        console.log(`   URL: ${url}`);
        console.log(`   Reason: ${result.reason}`);
        console.log('');
    });
    
    // Generate statistics
    const stats = detector.generateStats(results);
    
    console.log('📈 Detection Statistics:');
    console.log('=' .repeat(40));
    console.log(`Total URLs tested: ${stats.total}`);
    console.log(`Detected as portals: ${stats.portals}`);
    console.log(`Detected as legitimate: ${stats.legitimate}`);
    console.log(`Recommendation to AVOID: ${stats.recommendations.AVOID}`);
    console.log(`Recommendation to PROCESS: ${stats.recommendations.PROCESS}`);
    
    console.log('\n📋 Categories breakdown:');
    Object.entries(stats.categories).forEach(([category, count]) => {
        console.log(`  ${category}: ${count}`);
    });
    
    // Test specific detection methods
    console.log('\n🔍 Testing specific detection methods:');
    
    const testCases = [
        { url: 'https://www.stepstone.de/jobs/1234', expected: true },
        { url: 'https://www.siemens.de/karriere', expected: false },
        { url: 'https://www.facebook.com/company', expected: true },
        { url: 'https://www.bmw.de/jobs', expected: false }
    ];
    
    let correctDetections = 0;
    testCases.forEach(testCase => {
        const shouldAvoid = detector.shouldAvoidDomain(testCase.url);
        const isCorrect = shouldAvoid === testCase.expected;
        
        if (isCorrect) correctDetections++;
        
        const resultIcon = isCorrect ? '✅' : '❌';
        console.log(`${resultIcon} ${testCase.url}: Expected ${testCase.expected ? 'AVOID' : 'PROCESS'}, Got ${shouldAvoid ? 'AVOID' : 'PROCESS'}`);
    });
    
    const accuracy = (correctDetections / testCases.length * 100).toFixed(1);
    console.log(`\n🎯 Detection Accuracy: ${accuracy}% (${correctDetections}/${testCases.length})`);
    
    // Test pattern listing
    const allPatterns = detector.getAllPortalPatterns();
    console.log(`\n📚 Total portal patterns loaded: ${allPatterns.length}`);
    console.log('Sample patterns:', allPatterns.slice(0, 10).join(', '));
    
    console.log('\n🎉 Portal detection testing completed!');
    
    return {
        results: results,
        stats: stats,
        accuracy: accuracy,
        correctDetections: correctDetections,
        totalTests: testCases.length
    };
}

// Run test if called directly
if (require.main === module) {
    console.log('🚀 Starting portal detection test...');
    
    try {
        const testResults = testPortalDetection();
        
        console.log('\n✅ All tests completed successfully');
        if (testResults.accuracy >= 75) {
            console.log('🎯 Portal detection accuracy is acceptable for production use');
        } else {
            console.log('⚠️ Portal detection accuracy may need improvement');
        }
        
    } catch (error) {
        console.error('❌ Portal detection test failed:', error.message);
        process.exit(1);
    }
}

module.exports = { testPortalDetection };