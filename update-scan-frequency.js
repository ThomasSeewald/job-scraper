const fs = require('fs');
const path = require('path');

/**
 * Update scan frequency and PLZ count
 */
function updateScanSettings() {
    console.log('🔧 Scan-Einstellungen Konfigurator');
    console.log('====================================');
    
    console.log('\n📊 Aktuelle Einstellung:');
    console.log('• Alle 4 Stunden');
    console.log('• 50 PLZ für Jobs + 50 PLZ für Ausbildung = 100 PLZ total');
    console.log('• 600 PLZ pro Tag');
    console.log('• ~14 Tage für komplette Deutschland-Abdeckung');
    
    console.log('\n⚡ Optimierungs-Optionen:');
    console.log('');
    console.log('Option 1 - Mehr PLZ pro Scan:');
    console.log('• 100 PLZ für Jobs + 100 PLZ für Ausbildung = 200 PLZ total');
    console.log('• 1,200 PLZ pro Tag → 7 Tage für komplette Abdeckung');
    console.log('');
    console.log('Option 2 - Häufigere Scans:');
    console.log('• Alle 2 Stunden statt 4 Stunden');
    console.log('• 1,200 PLZ pro Tag → 7 Tage für komplette Abdeckung');
    console.log('');
    console.log('Option 3 - Maximum:');
    console.log('• 200 PLZ pro Jobtyp + alle 2 Stunden');
    console.log('• 2,400 PLZ pro Tag → 3-4 Tage für komplette Abdeckung');
    
    console.log('\n🎯 Empfehlung:');
    console.log('Option 1 ist optimal - verdoppelt Coverage ohne Überlastung');
    
    console.log('\nUm Option 1 zu aktivieren:');
    console.log('node update-scan-frequency.js --apply-option1');
}

function applyOption1() {
    const backgroundScanFile = path.join(__dirname, 'run-background-scan.js');
    let content = fs.readFileSync(backgroundScanFile, 'utf8');
    
    // Update PLZ counts from 50 to 100
    content = content.replace(
        'const jobResults = await jobScraper.runIntelligentScraping(50);',
        'const jobResults = await jobScraper.runIntelligentScraping(100);'
    );
    content = content.replace(
        'const ausbildungResults = await ausbildungScraper.runIntelligentScraping(50);',
        'const ausbildungResults = await ausbildungScraper.runIntelligentScraping(100);'
    );
    
    // Update comments
    content = content.replace(
        '// Jobs scan (50 postal codes)',
        '// Jobs scan (100 postal codes)'
    );
    content = content.replace(
        '// Ausbildung scan (50 postal codes)',
        '// Ausbildung scan (100 postal codes)'
    );
    
    fs.writeFileSync(backgroundScanFile, content);
    
    console.log('✅ Option 1 aktiviert!');
    console.log('📊 Neue Einstellung:');
    console.log('• 100 PLZ für Jobs + 100 PLZ für Ausbildung = 200 PLZ total');
    console.log('• 1,200 PLZ pro Tag');
    console.log('• ~7 Tage für komplette Deutschland-Abdeckung');
    console.log('');
    console.log('🔄 Änderung wird beim nächsten automatischen Scan (alle 4h) aktiv');
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--apply-option1')) {
    applyOption1();
} else {
    updateScanSettings();
}