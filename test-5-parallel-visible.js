/**
 * Test script to launch 5 parallel Puppeteer processes in visible mode
 * Each process will handle just one employer and keep the browser open
 */

const { spawn } = require('child_process');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load database configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
const dbConfig = config.production;

async function getTestEmployers() {
    const pool = new Pool(dbConfig);
    
    const query = `
        WITH employer_newest_jobs AS (
            SELECT 
                e.id,
                e.name,
                e.normalized_name,
                j.refnr,
                j.titel,
                j.arbeitsort_ort,
                j.arbeitsort_plz,
                j.aktuelleveroeffentlichungsdatum,
                ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY j.aktuelleveroeffentlichungsdatum DESC) as rn
            FROM job_scrp_employers e
            INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON e.name = j.arbeitgeber
            WHERE (e.email_extraction_attempted = false OR e.email_extraction_attempted IS NULL)
                AND (e.contact_emails IS NULL OR e.contact_emails = '')
                AND (e.website IS NULL OR e.website = '')
                AND (j.externeurl IS NULL OR j.externeurl = '')
                AND j.refnr IS NOT NULL
                AND j.is_active = true
        )
        SELECT 
            id,
            name,
            normalized_name,
            refnr,
            titel,
            arbeitsort_ort,
            arbeitsort_plz,
            aktuelleveroeffentlichungsdatum
        FROM employer_newest_jobs 
        WHERE rn = 1
        ORDER BY aktuelleveroeffentlichungsdatum DESC
        LIMIT 5
    `;
    
    try {
        const result = await pool.query(query);
        await pool.end();
        return result.rows;
    } catch (error) {
        console.error('Error fetching employers:', error.message);
        await pool.end();
        return [];
    }
}

async function createSingleEmployerScript(employer, processId) {
    const scriptContent = `
const puppeteer = require('puppeteer');
const EmailExtractor = require('./src/email-extractor');
const IndependentCaptchaSolver = require('./src/independent-captcha-solver');
const DomainEmailExtractor = require('./src/domain-email-extractor');
const PortalDetector = require('./src/portal-detector');

async function processSingleEmployer() {
    console.log('🚀 Process ${processId} starting for employer: ${employer.name}');
    console.log('🔗 URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/${employer.refnr}');
    
    const emailExtractor = new EmailExtractor();
    const captchaSolver = new IndependentCaptchaSolver();
    const domainExtractor = new DomainEmailExtractor();
    const portalDetector = new PortalDetector();
    
    // Launch browser in VISIBLE mode
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1200,800',
            '--window-position=${100 + (processId - 1) * 250},${100 + (processId - 1) * 50}'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    try {
        // Navigate to the job detail page
        await page.goto('https://www.arbeitsagentur.de/jobsuche/jobdetail/${employer.refnr}', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Check for CAPTCHA
        const captchaSelector = 'img[src*="captcha"]';
        const captchaImage = await page.$(captchaSelector);
        
        if (captchaImage) {
            console.log('🧩 Process ${processId}: CAPTCHA detected!');
            
            // Get CAPTCHA image source
            const captchaSrc = await captchaImage.evaluate(el => el.src);
            console.log('📸 CAPTCHA source:', captchaSrc);
            
            // Solve CAPTCHA
            const solutionResult = await captchaSolver.solveCaptchaFromUrl(captchaSrc);
            if (solutionResult.success) {
                console.log('✅ CAPTCHA solution:', solutionResult.text);
                
                // Enter solution
                await page.type('input[name="captcha"], input[type="text"]', solutionResult.text);
                
                // Submit
                await page.click('button[type="submit"], input[type="submit"]');
                console.log('📤 CAPTCHA submitted');
                
                // Wait for verification
                await page.waitForTimeout(5000);
            } else {
                console.log('❌ CAPTCHA solving failed');
            }
        }
        
        // Extract emails
        const pageContent = await page.content();
        const emailResult = emailExtractor.extractEmails(pageContent, '${employer.titel}', '${employer.name}');
        
        console.log('\\n📊 Process ${processId} Results:');
        console.log('   Employer: ${employer.name}');
        console.log('   Direct emails found:', emailResult.emails || 'None');
        console.log('   Website found:', emailResult.applicationWebsite || 'None');
        
        // Check for domain extraction opportunity
        if (!emailResult.emails && emailResult.applicationWebsite) {
            const portalCheck = portalDetector.detectPortal(emailResult.applicationWebsite);
            console.log('   Portal detection:', portalCheck.isPortal ? 'PORTAL' : 'LEGITIMATE', '(' + portalCheck.confidence + ')');
            
            if (!portalCheck.isPortal || portalCheck.confidence < 0.8) {
                console.log('   Would attempt domain extraction from:', emailResult.applicationWebsite);
            } else {
                console.log('   Skipping domain extraction - detected as', portalCheck.category);
            }
        }
        
        console.log('\\n✅ Process ${processId} completed - browser remains open for inspection');
        console.log('🔍 You can now inspect the page and close the browser when ready');
        
    } catch (error) {
        console.error('❌ Process ${processId} error:', error.message);
    }
    
    // Keep the process alive - DO NOT close browser
    console.log('⏸️ Process ${processId} waiting... (Press Ctrl+C to exit)');
    await new Promise(() => {}); // Wait forever
}

processSingleEmployer().catch(console.error);
`;
    
    const filename = `temp-process-${processId}.js`;
    fs.writeFileSync(filename, scriptContent);
    return filename;
}

async function launchFiveParallelProcesses() {
    console.log('🚀 Launching 5 parallel Puppeteer processes in VISIBLE mode...');
    console.log('📌 Each browser will remain open for manual inspection and closing');
    console.log('');
    
    // Get 5 employers from database
    const employers = await getTestEmployers();
    
    if (employers.length < 5) {
        console.error(`❌ Only found ${employers.length} employers to process`);
        return;
    }
    
    console.log('📋 Employers to process:');
    employers.forEach((emp, i) => {
        console.log(`   ${i + 1}. ${emp.name} (${emp.refnr})`);
    });
    console.log('');
    
    // Create and launch 5 processes
    for (let i = 0; i < 5; i++) {
        const employer = employers[i];
        const processId = i + 1;
        
        // Create temporary script for this process
        const scriptFile = await createSingleEmployerScript(employer, processId);
        
        console.log(`🔄 Starting Process ${processId} for: ${employer.name}`);
        
        // Launch the process
        const child = spawn('node', [scriptFile], {
            stdio: 'inherit',
            detached: false
        });
        
        child.on('error', (error) => {
            console.error(`❌ Process ${processId} failed to start:`, error.message);
        });
        
        // Small delay between launches
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n✅ All 5 processes launched successfully');
    console.log('📌 Each browser window shows a different employer');
    console.log('🔍 You can inspect each window and close them manually when done');
    console.log('⏹️ Press Ctrl+C in this terminal to stop all processes');
}

// Run the test
if (require.main === module) {
    launchFiveParallelProcesses().catch(console.error);
}

module.exports = { launchFiveParallelProcesses };