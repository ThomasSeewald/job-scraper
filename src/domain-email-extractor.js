const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * Domain-based Email Extractor using Scrapy Technology
 * 
 * This script processes employer domains (not external portals) using
 * the existing Scrapy email extraction technology from the Large Tables project.
 * 
 * Strategy:
 * 1. Query job_scrp_domain_analysis table for unprocessed employer_domain entries
 * 2. Use existing Scrapy script to extract emails from legitimate domains
 * 3. Update job_scrp_domain_analysis table with extraction results
 * 4. Update job_scrp_employers table with discovered emails
 */

class DomainEmailExtractor {
    constructor() {
        // Database configuration
        this.pool = new Pool({
            user: 'odoo',
            host: 'localhost',
            database: 'jetzt',
            password: 'odoo',
            port: 5473,
        });

        // Path to existing Scrapy script in Large Tables project
        this.scrapyScriptPath = '/Users/thomassee/Docker/containers/largeTables/mnt/extra-addons/_our_my_sql/models/scrapy_script.py';
        
        // Batch size for processing domains
        this.batchSize = 10;
        
        // Delay between domain extractions (to be respectful)
        this.delayBetweenDomains = 5000; // 5 seconds
    }

    /**
     * Get unprocessed employer domains from job_scrp_domain_analysis table
     */
    async getUnprocessedEmployerDomains(limit = 10) {
        const query = `
            SELECT domain, base_domain, frequency 
            FROM job_scrp_domain_analysis 
            WHERE classification = 'employer_domain' 
                AND email_extraction_attempted = false
            ORDER BY frequency DESC
            LIMIT $1
        `;
        
        const result = await this.pool.query(query, [limit]);
        return result.rows;
    }

    /**
     * Call the existing Scrapy script using Python subprocess
     */
    async extractEmailsWithScrapy(domain) {
        return new Promise((resolve, reject) => {
            // Ensure domain has protocol
            const fullDomain = domain.startsWith('http') ? domain : `https://${domain}`;
            
            // Create a temporary Python script to call the Scrapy function
            const pythonScript = `
import sys
sys.path.append('/Users/thomassee/Docker/containers/largeTables/mnt/extra-addons/_our_my_sql/models')
from scrapy_script import get_emails
import json

try:
    result = get_emails('${fullDomain}')
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}))
            `;

            const pythonProcess = spawn('python3', ['-c', pythonScript], {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000 // 30 second timeout
            });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse JSON output: ${stdout}`));
                    }
                } else {
                    reject(new Error(`Python process exited with code ${code}: ${stderr}`));
                }
            });

            pythonProcess.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Process extraction results and extract unique emails
     */
    processScrapyResults(results) {
        const allEmails = new Set();
        const metadata = {
            impressum_link: results.impressum_link || '',
            kontakt_link: results.kontakt_link || '',
            error: results.error || null,
            emails_by_section: {}
        };

        // Collect emails from all sections
        for (const [section, emails] of Object.entries(results)) {
            if (Array.isArray(emails) && emails.length > 0) {
                metadata.emails_by_section[section] = emails;
                emails.forEach(email => {
                    // Basic email validation
                    if (this.isValidEmail(email)) {
                        allEmails.add(email.toLowerCase());
                    }
                });
            }
        }

        return {
            emails: Array.from(allEmails),
            metadata: metadata
        };
    }

    /**
     * Basic email validation
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email) && 
               !email.includes('example.') && 
               !email.includes('test@') &&
               !email.includes('noreply') &&
               !email.includes('no-reply');
    }

    /**
     * Update job_scrp_domain_analysis table with extraction results
     */
    async updateDomainAnalysis(domain, emails, metadata) {
        const query = `
            UPDATE job_scrp_domain_analysis 
            SET email_extraction_attempted = true,
                emails_found = $2,
                last_extraction_date = CURRENT_TIMESTAMP,
                notes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE domain = $1
        `;
        
        const notes = JSON.stringify({
            extraction_metadata: metadata,
            extraction_method: 'scrapy_integration'
        });

        await this.pool.query(query, [domain, emails.length, notes]);
    }

    /**
     * Update job_scrp_employers table with discovered emails
     */
    async updateEmployersWithEmails(domain, emails) {
        if (emails.length === 0) return;

        // Find job_scrp_employers that use this domain
        const findEmployersQuery = `
            SELECT DISTINCT e.id, e.name, e.contact_emails
            FROM job_scrp_employers e
            WHERE e.website LIKE $1 
               OR e.application_website LIKE $1
        `;
        
        const domainPattern = `%${domain}%`;
        const employerResult = await this.pool.query(findEmployersQuery, [domainPattern]);

        if (employerResult.rows.length === 0) {
            console.log(`No job_scrp_employers found for domain: ${domain}`);
            return;
        }

        // Update each employer with the discovered emails
        for (const employer of employerResult.rows) {
            const existingEmails = employer.contact_emails ? 
                employer.contact_emails.split(',').map(e => e.trim()) : [];
            
            // Merge with existing emails, avoiding duplicates
            const allEmails = [...new Set([...existingEmails, ...emails])];
            
            const updateQuery = `
                UPDATE job_scrp_employers 
                SET contact_emails = $2,
                    email_extraction_date = CURRENT_TIMESTAMP,
                    email_extraction_attempted = true
                WHERE id = $1
            `;
            
            await this.pool.query(updateQuery, [employer.id, allEmails.join(', ')]);
            console.log(`Updated employer ${employer.name} with ${emails.length} new emails`);
        }
    }

    /**
     * Process a single domain for email extraction
     */
    async processDomain(domainInfo) {
        const { domain, base_domain, frequency } = domainInfo;
        
        console.log(`Processing domain: ${domain} (frequency: ${frequency})`);
        
        try {
            // Use Scrapy to extract emails
            const scrapyResults = await this.extractEmailsWithScrapy(domain);
            
            // Process results
            const { emails, metadata } = this.processScrapyResults(scrapyResults);
            
            console.log(`Found ${emails.length} emails on ${domain}`);
            if (emails.length > 0) {
                console.log(`Emails: ${emails.join(', ')}`);
            }
            
            if (metadata.error) {
                console.log(`Scrapy error for ${domain}: ${metadata.error}`);
            }

            // Update database
            await this.updateDomainAnalysis(domain, emails, metadata);
            await this.updateEmployersWithEmails(domain, emails);
            
            return {
                domain,
                success: true,
                emailsFound: emails.length,
                emails,
                error: metadata.error
            };

        } catch (error) {
            console.error(`Error processing domain ${domain}:`, error.message);
            
            // Still mark as attempted even if failed
            await this.updateDomainAnalysis(domain, [], { error: error.message });
            
            return {
                domain,
                success: false,
                emailsFound: 0,
                emails: [],
                error: error.message
            };
        }
    }

    /**
     * Main execution method
     */
    async run(maxDomains = 10) {
        console.log('Starting domain-based email extraction using Scrapy technology...');
        
        try {
            // Get unprocessed employer domains
            const domains = await this.getUnprocessedEmployerDomains(maxDomains);
            
            if (domains.length === 0) {
                console.log('No unprocessed employer domains found.');
                return;
            }

            console.log(`Found ${domains.length} unprocessed employer domains`);

            const results = [];
            
            // Process domains one by one with delays
            for (let i = 0; i < domains.length; i++) {
                const domain = domains[i];
                
                console.log(`\n--- Processing ${i + 1}/${domains.length}: ${domain.domain} ---`);
                
                const result = await this.processDomain(domain);
                results.push(result);
                
                // Add delay between domains (except for the last one)
                if (i < domains.length - 1) {
                    console.log(`Waiting ${this.delayBetweenDomains / 1000} seconds before next domain...`);
                    await new Promise(resolve => setTimeout(resolve, this.delayBetweenDomains));
                }
            }

            // Summary
            const successful = results.filter(r => r.success).length;
            const totalEmails = results.reduce((sum, r) => sum + r.emailsFound, 0);
            
            console.log(`\n--- Summary ---`);
            console.log(`Domains processed: ${results.length}`);
            console.log(`Successful extractions: ${successful}`);
            console.log(`Total emails found: ${totalEmails}`);
            console.log(`Average emails per domain: ${(totalEmails / results.length).toFixed(1)}`);

            return results;

        } catch (error) {
            console.error('Error in main execution:', error);
            throw error;
        } finally {
            await this.pool.end();
        }
    }
}

// CLI execution
if (require.main === module) {
    const maxDomains = parseInt(process.argv[2]) || 5;
    
    const extractor = new DomainEmailExtractor();
    extractor.run(maxDomains)
        .then(results => {
            console.log('\nDomain email extraction completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Domain email extraction failed:', error);
            process.exit(1);
        });
}

module.exports = DomainEmailExtractor;