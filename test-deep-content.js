const puppeteer = require('puppeteer');

async function testDeepContent() {
    console.log('🔍 Testing deep content extraction from Arbeitsagentur...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    
    try {
        // Test with multiple jobs to see if any contain contact info
        const testJobs = [
            '10000-1201370366-S', // Dieffenbacher Maschinenfabrik GmbH
            '12518-WC94YJ-3B3-S', // Hotel Alt Lohbrügger Hof e.K.
            '12518-ZZ3SB9-ZL2-S'  // Maritim Hotel
        ];
        
        for (const jobRef of testJobs) {
            const testUrl = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${jobRef}`;
            console.log(`\n🌐 Loading: ${testUrl}`);
            
            await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check for application button or contact section
            console.log('🔍 Looking for application/contact sections...');
            
            // Look for "Jetzt bewerben" or similar buttons
            const applyButtons = await page.$$('button, a');
            for (const button of applyButtons) {
                const text = await page.evaluate(el => el.textContent?.toLowerCase() || '', button);
                if (text.includes('bewerben') || text.includes('kontakt') || text.includes('bewerbung')) {
                    console.log(`📧 Found application/contact button: "${text}"`);
                    
                    // Try clicking to see if it reveals contact info
                    try {
                        await button.click();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // Check if new content appeared
                        const newContent = await page.content();
                        const emailMatches = newContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
                        if (emailMatches.length > 0) {
                            console.log(`✅ Found emails after clicking: ${emailMatches}`);
                        }
                    } catch (error) {
                        console.log(`⚠️ Could not click button: ${error.message}`);
                    }
                }
            }
            
            // Check job description for company contact info
            const jobDescription = await page.evaluate(() => {
                const descElement = document.querySelector('[data-testid="job-description"], .job-description, .stellenbeschreibung');
                return descElement ? descElement.innerText : '';
            });
            
            console.log('📄 Job description length:', jobDescription.length);
            
            // Look for typical German contact patterns
            const contactPatterns = [
                /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
                /kontakt:?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                /bewerbung.*?:?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                /e-?mail:?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
            ];
            
            let foundEmails = [];
            contactPatterns.forEach((pattern, index) => {
                const matches = jobDescription.match(pattern) || [];
                if (matches.length > 0) {
                    console.log(`📧 Pattern ${index + 1} found: ${matches}`);
                    foundEmails = foundEmails.concat(matches);
                }
            });
            
            if (foundEmails.length === 0) {
                console.log('❌ No emails found in job description');
                
                // Show a snippet of the description to understand the content
                console.log('📝 Description snippet (first 300 chars):');
                console.log(jobDescription.substring(0, 300));
            }
            
            // Check for employer/company website that might be clickable
            const companyLinks = await page.$$('a[href*="http"]');
            console.log(`🔗 Found ${companyLinks.length} external links`);
            
            for (const link of companyLinks.slice(0, 3)) { // Check first 3 links
                const href = await page.evaluate(el => el.href, link);
                const text = await page.evaluate(el => el.textContent?.trim() || '', link);
                
                if (href && !href.includes('arbeitsagentur.de') && !href.includes('bundesagentur.de')) {
                    console.log(`🌐 External link: ${text} -> ${href}`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
}

testDeepContent();