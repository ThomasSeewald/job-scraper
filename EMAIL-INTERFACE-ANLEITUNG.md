# Email-Adressen Suchinterface

Ein benutzerfreundliches Web-Interface zur Suche und zum Export von Email-Adressen aus gescrapten Stellenanzeigen.

## 🚀 Schnellstart

```bash
# Interface starten
./start-email-interface.sh

# Oder manuell:
node src/email-search-interface.js
```

**Zugriff**: http://localhost:3002

## ✨ Features

### 🔍 Erweiterte Suchfunktionen

1. **Berufsart-Suche**
   - Suche nach Stellentiteln oder Berufsbezeichnungen
   - Beispiele: "Informatiker", "Verkäufer", "Krankenpfleger"
   - Autocomplete mit verfügbaren Berufsarten

2. **Entfernungsfilter**
   - Suche in bestimmter Entfernung von PLZ oder Stadt
   - Entfernungen: 5, 10, 25, 50, 100, 200 km
   - Beispiel: "Alle IT-Jobs in 50 km Umkreis von München"

3. **Firmenfilter**
   - Suche nach spezifischen Unternehmen
   - Autocomplete mit verfügbaren Firmennamen

4. **Domain-Filter**
   - Suche nach bestimmten Email-Domains
   - Beispiel: "company.de" oder "gmail.com"

### 📊 Dashboard-Statistiken

- **Stellenanzeigen gesamt**: Anzahl aller aktiven Jobs
- **Mit Email-Adressen**: Jobs mit extrahierten Kontaktdaten
- **Unique Domains**: Anzahl verschiedener Unternehmens-Domains
- **Berufsarten**: Anzahl verschiedener Job-Kategorien

### 📈 Beliebte Berufsarten

- Schnellzugriff auf häufigste Berufe mit Email-Adressen
- Ein-Klick-Suche für beliebte Kategorien

### 📋 Ergebnisanzeige

Jedes Suchergebnis zeigt:
- **Stellentitel** und **Berufsbezeichnung**
- **Unternehmen** und **Standort** (mit PLZ)
- **Haupt-Email-Adresse** (klickbar für mailto:)
- **Unternehmens-Domain**
- **Entfernung** (wenn Entfernungsfilter verwendet)
- **Veröffentlichungsdatum**

### 📤 Export-Funktionen

#### CSV-Export
```
- Spalten: Referenz-Nr, Stellentitel, Beruf, Arbeitgeber, Ort, PLZ, Beste Email, Alle Emails, Domain, Anzahl Emails, Veröffentlicht
- Format: UTF-8 mit BOM (Excel-kompatibel)
- Dateiname: email-export-YYYY-MM-DD.csv
```

#### JSON-Export
```json
{
  "exportDate": "2025-06-02T19:30:00.000Z",
  "totalResults": 1250,
  "searchParams": {
    "jobType": "Informatiker",
    "location": "Berlin",
    "distance": "50"
  },
  "results": [...]
}
```

## 🎯 Anwendungsbeispiele

### Beispiel 1: IT-Jobs in Berlin
```
Berufsart: "Informatiker"
Ort: "Berlin"
Entfernung: "25 km"
→ Exportiert alle IT-Kontakte im Berliner Raum
```

### Beispiel 2: Verkaufsjobs deutschlandweit
```
Berufsart: "Verkäufer"
(keine Orts-/Entfernungsangabe)
→ Alle Verkaufsjobs mit Email-Adressen
```

### Beispiel 3: Bestimmtes Unternehmen
```
Unternehmen: "Mercedes"
→ Alle Jobs von Mercedes-Unternehmen
```

### Beispiel 4: Domain-spezifische Suche
```
Email-Domain: "startup.de"
→ Alle Startup-Unternehmen mit .de-Domains
```

## 🔧 Technische Details

### Datenbankanbindung
- Verbindung zur PostgreSQL-Datenbank (Port 5473)
- Zugriff auf Tabellen: `arbeitsagentur_jobs_v2`, `job_details`
- Nur Jobs mit erfolgreich extrahierten Email-Adressen

### Entfernungsberechnung
- Haversine-Formel für GPS-Koordinaten
- Automatische Auflösung von PLZ/Stadt zu Koordinaten
- Fallback auf Textsuche wenn keine Koordinaten verfügbar

### Performance-Optimierung
- Paginierung (100 Ergebnisse pro Seite)
- Lazy Loading mit "Weitere Ergebnisse laden"
- Datenbankindizes für schnelle Suche
- Autocomplete-Caching

### Sicherheit
- SQL-Injection-Schutz durch parameterized queries
- Input-Sanitization für alle Benutzereingaben
- Error-Handling für robuste Anwendung

## 📁 Dateistruktur

```
job-scraper/
├── src/
│   └── email-search-interface.js    # Haupt-Server
├── views/
│   ├── email-search.ejs            # Haupt-Interface
│   └── error.ejs                   # Fehlerseite
├── public/                         # Statische Dateien
├── start-email-interface.sh        # Startup-Script
└── EMAIL-INTERFACE-ANLEITUNG.md   # Diese Datei
```

## 🚨 Problembehandlung

### Server startet nicht
```bash
# Prüfe Node.js Installation
node --version

# Installiere Dependencies
npm install

# Prüfe Datenbankverbindung
npm test
```

### Keine Suchergebnisse
- Überprüfe ob Email-Extraktion läuft
- Prüfe Datenbankinhalt: `SELECT COUNT(*) FROM job_details WHERE best_email IS NOT NULL`
- Erweitere Suchkriterien (weniger spezifisch)

### Export-Fehler
- Prüfe Festplattenspeicher
- Kleine Suchfilter verwenden (unter 10.000 Ergebnisse)
- Browser-Popup-Blocker deaktivieren

## 📞 Support

Bei Problemen oder Fragen:
1. Prüfe diese Anleitung
2. Schaue in die Browser-Konsole (F12)
3. Prüfe Server-Logs im Terminal

## 🔄 Updates

Um das Interface zu aktualisieren:
```bash
git pull
npm install
./start-email-interface.sh
```