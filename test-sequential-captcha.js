/**
 * Sequential CAPTCHA Test - Start browsers one by one to test CAPTCHA behavior
 * Start first browser, wait for CAPTCHA to be solved, then start next one
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

async function processSingleEmployer() {
    console.log('🚀 Process ${processId} starting for employer: ${employer.name}');
    console.log('🔗 URL: https://www.arbeitsagentur.de/jobsuche/jobdetail/${employer.refnr}');
    
    const emailExtractor = new EmailExtractor();
    const captchaSolver = new IndependentCaptchaSolver();
    
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
            console.log('🧩 Process ${processId}: CAPTCHA DETECTED!');
            
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
                console.log('📤 CAPTCHA submitted - waiting for verification...');
                
                // Wait for verification
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Check if CAPTCHA is gone
                const stillHasCaptcha = await page.$(captchaSelector);
                if (!stillHasCaptcha) {
                    console.log('✅ Process ${processId}: CAPTCHA SOLVED SUCCESSFULLY!');
                } else {
                    console.log('❌ Process ${processId}: CAPTCHA still present');
                }
            } else {
                console.log('❌ CAPTCHA solving failed');
            }
        } else {
            console.log('🆓 Process ${processId}: NO CAPTCHA - FREE ACCESS!');
        }
        
        // Extract emails
        const pageContent = await page.content();
        const emailResult = emailExtractor.extractEmails(pageContent, '${employer.titel}', '${employer.name}');
        
        console.log('\\n📊 Process ${processId} Results:');
        console.log('   Employer: ${employer.name}');
        console.log('   Direct emails found:', emailResult.emails || 'None');
        console.log('   Website found:', emailResult.applicationWebsite || 'None');
        
        console.log('\\n✅ Process ${processId} completed - browser remains open for inspection');
        console.log('🔍 You can now inspect the page and close the browser when ready');
        
    } catch (error) {
        console.error('❌ Process ${processId} error:', error.message);
    }
    
    // Keep the process alive - DO NOT close browser
    console.log('⏸️ Process ${processId} waiting... (Press Ctrl+C to exit this process)');
    process.on('SIGINT', () => {
        console.log('\\n🛑 Process ${processId} received exit signal - closing browser...');
        browser.close().then(() => {
            console.log('🧹 Process ${processId} browser closed');
            process.exit(0);
        });
    });
    
    await new Promise(() => {}); // Wait forever
}

processSingleEmployer().catch(console.error);
`;
    
    const filename = `temp-process-${processId}.js`;
    fs.writeFileSync(filename, scriptContent);
    return filename;
}

function waitForUserInput(message) {
    return new Promise((resolve) => {
        process.stdout.write(message);
        process.stdin.once('data', () => {
            resolve();
        });
    });
}

async function launchSequentialProcesses() {
    console.log('🧪 Sequential CAPTCHA Test - Testing CAPTCHA behavior across multiple sessions');
    console.log('📌 Each browser will remain open for manual inspection');
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
    
    const processes = [];
    
    // Launch processes one by one
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
        
        processes.push({ child, processId, scriptFile, employer });
        
        child.on('error', (error) => {
            console.error(`❌ Process ${processId} failed to start:`, error.message);
        });
        
        if (i === 0) {
            // For the first process, wait for user confirmation that CAPTCHA is solved
            await waitForUserInput(`\\n⏳ Process 1 started. Please wait for CAPTCHA to be solved, then press ENTER to start Process 2...`);
        } else {
            // For subsequent processes, wait for user to decide when to start the next one
            if (i < 4) {
                await waitForUserInput(`\\n⏳ Process ${processId} started. Check if it has CAPTCHA, then press ENTER to start Process ${processId + 1}...`);
            }
        }
    }
    
    console.log('\\n✅ All 5 processes launched');
    console.log('📊 Now you can observe the CAPTCHA pattern across all browser windows');
    console.log('🔍 Each window shows a different employer and their CAPTCHA status');
    console.log('⏹️ Press Ctrl+C in each browser terminal to close individual processes');
    console.log('⏹️ Press Ctrl+C here to clean up all temp files');
    
    // Wait for cleanup signal
    process.on('SIGINT', () => {
        console.log('\\n🧹 Cleaning up temporary files...');
        processes.forEach(({ scriptFile }) => {
            try {
                fs.unlinkSync(scriptFile);
                console.log(`🗑️ Deleted ${scriptFile}`);
            } catch (error) {
                // File might already be deleted
            }
        });
        console.log('✅ Cleanup completed');
        process.exit(0);
    });
    
    await new Promise(() => {}); // Wait forever
}

// Run the test
if (require.main === module) {
    launchSequentialProcesses().catch(console.error);
}

module.exports = { launchSequentialProcesses };