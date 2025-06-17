const fs = require('fs');
const path = require('path');

/**
 * Update scanning timeframe
 */
function showTimeframeOptions() {
    console.log('📅 Scan-Zeitraum Konfigurator');
    console.log('==============================');
    
    console.log('\n📊 Aktuelle Einstellung: 28 Tage');
    console.log('• Scannt Jobs der letzten 28 Tage');
    console.log('• Umfassende Marktabdeckung');
    console.log('• Geeignet für initiale Datensammlung');
    
    console.log('\n⚙️ Verfügbare Optionen:');
    console.log('');
    console.log('1. 7 Tage (Empfohlen für laufenden Betrieb):');
    console.log('   • Nur neue Jobs der letzten Woche');
    console.log('   • Weniger API-Calls, effizienter');
    console.log('   • Weniger Duplikate');
    console.log('');
    console.log('2. 14 Tage (Ausgewogen):');
    console.log('   • Mittlere Abdeckung');
    console.log('   • Balance zwischen Vollständigkeit und Effizienz');
    console.log('');
    console.log('3. 28 Tage (Aktuell):');
    console.log('   • Maximale Marktabdeckung');
    console.log('   • Viele Duplikate, aber vollständig');
    console.log('');
    console.log('4. 3 Tage (Nur neue Jobs):');
    console.log('   • Nur brandneue Stellenausschreibungen');
    console.log('   • Sehr effizient, minimale Duplikate');
    
    console.log('\n🎯 Empfehlung:');
    console.log('Nach Initial-Phase → Umstellung auf 7 Tage für Effizienz');
    
    console.log('\nUm zu ändern:');
    console.log('node update-timeframe.js --days=7   # Umstellung auf 7 Tage');
    console.log('node update-timeframe.js --days=14  # Umstellung auf 14 Tage');
    console.log('node update-timeframe.js --days=3   # Nur brandneue Jobs');
}

function updateTimeframe(days) {
    const backgroundScanFile = path.join(__dirname, 'run-background-scan.js');
    let content = fs.readFileSync(backgroundScanFile, 'utf8');
    
    // Update both job and ausbildung scanner initialization
    content = content.replace(
        'const jobScraper = new IntelligentJobScraper(\'job\', 28);',
        `const jobScraper = new IntelligentJobScraper('job', ${days});`
    );
    content = content.replace(
        'const ausbildungScraper = new IntelligentJobScraper(\'ausbildung\', 28);',
        `const ausbildungScraper = new IntelligentJobScraper('ausbildung', ${days});`
    );
    
    // Update log message
    content = content.replace(
        '📅 Will scan every 4 hours with 28-day lookback',
        `📅 Will scan every 4 hours with ${days}-day lookback`
    );
    
    fs.writeFileSync(backgroundScanFile, content);
    
    let description;
    switch(days) {
        case 3: description = 'Nur brandneue Jobs (sehr effizient)'; break;
        case 7: description = 'Letzte Woche (empfohlen für laufenden Betrieb)'; break;
        case 14: description = 'Letzte 2 Wochen (ausgewogen)'; break;
        case 28: description = 'Letzter Monat (maximale Abdeckung)'; break;
        default: description = `Letzte ${days} Tage`;
    }
    
    console.log(`✅ Zeitraum geändert auf ${days} Tage!`);
    console.log(`📊 Neue Einstellung: ${description}`);
    console.log('🔄 Änderung wird beim nächsten automatischen Scan aktiv');
    
    if (days <= 7) {
        console.log('\n💡 Vorteil: Weniger Duplikate, effizientere Scans');
    }
    if (days >= 21) {
        console.log('\n⚠️ Hinweis: Viele Duplikate, aber vollständige Marktabdeckung');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find(arg => arg.startsWith('--days='));

if (daysArg) {
    const days = parseInt(daysArg.split('=')[1]);
    if (days && days > 0 && days <= 365) {
        updateTimeframe(days);
    } else {
        console.log('❌ Ungültiger Wert. Bitte 1-365 Tage angeben.');
    }
} else {
    showTimeframeOptions();
}