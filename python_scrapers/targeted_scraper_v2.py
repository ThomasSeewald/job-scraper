#!/usr/bin/env python3
"""
Targeted Scraper V2 - Processes specific job reference numbers
Extends BaseScraper for all browser automation
"""

import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

from base_scraper import BaseScraper
from config import DB_CONFIG

logger = logging.getLogger(__name__)


class TargetedScraperV2(BaseScraper):
    """Scraper that processes specific reference numbers from a list"""
    
    def __init__(self, ref_numbers: List[str], worker_id: int = 99, 
                 delay_seconds: int = 0, headless: bool = True):
        super().__init__(f'targeted-v2-{worker_id}', worker_id)
        
        self.ref_numbers = ref_numbers
        self.current_index = 0
        self.delay_seconds = delay_seconds
        self.headless = headless
        
        # Override parent's headless setting
        if hasattr(self, 'browser') and self.browser:
            # Browser already initialized, can't change headless mode
            pass
        else:
            # Will be used when browser is initialized
            self._headless_override = headless
    
    async def _init_browser(self):
        """Override to use our headless setting"""
        # Temporarily change the global setting
        from config import BROWSER_HEADLESS
        original_headless = BROWSER_HEADLESS
        
        # Use our headless setting
        import config
        config.BROWSER_HEADLESS = self.headless
        
        # Call parent's init
        await super()._init_browser()
        
        # Restore original setting
        config.BROWSER_HEADLESS = original_headless
    
    def get_next_job(self) -> Optional[Dict[str, Any]]:
        """Get next job from the targeted list"""
        if self.current_index >= len(self.ref_numbers):
            return None
            
        refnr = self.ref_numbers[self.current_index]
        self.current_index += 1
        
        logger.info(f"🎯 Processing targeted job {self.current_index}/{len(self.ref_numbers)}: {refnr}")
        
        # Get job details from database
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            query = """
                SELECT 
                    j.refnr,
                    j.titel,
                    j.arbeitgeber,
                    j.arbeitsort_ort,
                    j.arbeitsort_plz,
                    e.id as employer_id,
                    e.name as employer_name
                FROM job_scrp_arbeitsagentur_jobs_v2 j
                LEFT JOIN job_scrp_employers e ON j.arbeitgeber = e.name
                WHERE j.refnr = %s AND j.is_active = true
            """
            
            cursor.execute(query, (refnr,))
            job = cursor.fetchone()
            
            if not job:
                logger.warning(f"Job {refnr} not found or not active")
                return None
                
            # Mark employer as being processed
            if job['employer_id']:
                cursor.execute("""
                    UPDATE job_scrp_employers 
                    SET email_extraction_attempted = true,
                        email_extraction_date = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (job['employer_id'],))
                conn.commit()
            
            return {
                'employer_id': job['employer_id'],
                'employer_name': job['employer_name'] or job['arbeitgeber'],
                'refnr': job['refnr'],
                'titel': job['titel']
            }
            
        except Exception as e:
            logger.error(f"Error getting job details for {refnr}: {e}")
            return None
        finally:
            cursor.close()
            conn.close()
    
    def save_results(self, job_data: Dict[str, Any], email_data: Dict[str, Any], success: bool):
        """Save scraping results to database"""
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        try:
            employer_name = job_data.get('employer_name', '')
            refnr = job_data.get('refnr', '')
            
            # Update employer with results
            if email_data.get('has_emails') or not success:
                cursor.execute("""
                    UPDATE job_scrp_employers 
                    SET contact_emails = %s,
                        website = %s
                    WHERE name = %s
                """, (
                    ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                    email_data.get('primary_domain'),
                    employer_name
                ))
            
            # Insert/update job_details
            cursor.execute("""
                INSERT INTO job_scrp_job_details (
                    reference_number, scraped_at, scraping_success,
                    has_emails, contact_emails, best_email,
                    company_domain, email_count, scraping_error,
                    email_source
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (reference_number) DO UPDATE SET
                    scraped_at = EXCLUDED.scraped_at,
                    scraping_success = EXCLUDED.scraping_success,
                    has_emails = EXCLUDED.has_emails,
                    contact_emails = EXCLUDED.contact_emails,
                    best_email = EXCLUDED.best_email,
                    company_domain = EXCLUDED.company_domain,
                    email_count = EXCLUDED.email_count,
                    scraping_error = EXCLUDED.scraping_error,
                    email_source = EXCLUDED.email_source,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                refnr,
                datetime.now(),
                success,
                email_data.get('has_emails', False),
                ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                email_data.get('primary_email'),
                email_data.get('primary_domain'),
                email_data.get('email_count', 0),
                email_data.get('error') if not success else None,
                'detail_page' if email_data.get('has_emails') else None
            ))
            
            # Mark job as inactive if it's a 404
            if not success and '404' in str(email_data.get('error', '')):
                cursor.execute("""
                    UPDATE job_scrp_arbeitsagentur_jobs_v2 
                    SET is_active = false,
                        marked_inactive_date = %s
                    WHERE refnr = %s
                """, (datetime.now(), refnr))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error saving results: {e}")
            conn.rollback()
        finally:
            cursor.close()
            conn.close()
    
    async def process_job(self, job_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process a single job"""
        refnr = job_data.get('refnr')
        employer_name = job_data.get('employer_name', 'Unknown')
        
        url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}"
        
        # Use BaseScraper's navigation
        success = await self.navigate_to_job(url)
        
        if not success:
            return {
                'success': False,
                'error': '404',
                'has_emails': False,
                'emails': []
            }
        
        # Use BaseScraper's email extraction
        email_data = await self.extract_emails_from_page(employer_name)
        
        # Check for external URL
        try:
            external_link = await self.page.query_selector('a#detail-bewerbung-url[href*="jobexport.de"]')
            if external_link:
                external_url = await external_link.get_attribute('href')
                if external_url:
                    import aiohttp
                    async with aiohttp.ClientSession() as session:
                        try:
                            async with session.get(external_url, allow_redirects=True, timeout=5) as resp:
                                final_url = str(resp.url)
                                from urllib.parse import urlparse
                                parsed = urlparse(final_url)
                                external_domain = parsed.netloc
                                logger.info(f"🌐 External domain: {external_domain}")
                                
                                if external_domain and not email_data.get('primary_domain'):
                                    email_data['primary_domain'] = external_domain
                        except Exception as e:
                            logger.warning(f"Failed to follow redirect: {e}")
        except Exception as e:
            logger.warning(f"Failed to check external URL: {e}")
        
        email_data['success'] = True
        return email_data
    
    async def run(self):
        """Run targeted extraction"""
        await self.initialize()
        
        logger.info(f"🚀 Starting targeted extraction for {len(self.ref_numbers)} jobs")
        
        jobs_processed = 0
        success_count = 0
        email_count = 0
        
        try:
            while jobs_processed < len(self.ref_numbers):
                job_data = self.get_next_job()
                
                if not job_data:
                    jobs_processed += 1
                    continue
                
                logger.info(f"📋 Processing: {job_data['titel']} @ {job_data['employer_name']}")
                
                result = await self.process_job(job_data)
                
                if result.get('success'):
                    success_count += 1
                    if result.get('emails'):
                        email_count += len(result['emails'])
                        logger.info(f"✅ Found {len(result['emails'])} emails")
                    else:
                        logger.info(f"❌ No emails found")
                else:
                    logger.info(f"❌ Failed: {result.get('error', 'Unknown error')}")
                
                # Save results - THIS IS CRITICAL!
                self.save_results(job_data, result, result.get('success', False))
                
                jobs_processed += 1
                
                # Delay between jobs
                if self.delay_seconds > 0 and jobs_processed < len(self.ref_numbers):
                    logger.info(f"⏳ Waiting {self.delay_seconds} seconds...")
                    await asyncio.sleep(self.delay_seconds)
                    
        finally:
            await self.cleanup()
        
        # Final stats
        logger.info(f"""
        ✅ Targeted extraction complete!
        📊 Stats:
        - Jobs processed: {jobs_processed}
        - Successful: {success_count}
        - Total emails found: {email_count}
        """)


async def main():
    """Main entry point"""
    import argparse
    import asyncio
    
    parser = argparse.ArgumentParser(description='Targeted scraper V2')
    parser.add_argument('--refs-file', type=str, required=True,
                        help='File containing reference numbers (one per line)')
    parser.add_argument('--worker-id', type=int, default=99, 
                        help='Worker ID (default: 99 for targeted)')
    parser.add_argument('--delay', type=int, default=0, 
                        help='Delay between jobs in seconds (default: 0)')
    parser.add_argument('--headless', action='store_true', 
                        help='Run in headless mode')
    
    args = parser.parse_args()
    
    # Read reference numbers from file
    try:
        with open(args.refs_file, 'r') as f:
            ref_numbers = [line.strip() for line in f if line.strip()]
    except Exception as e:
        logger.error(f"Error reading refs file: {e}")
        return
    
    if not ref_numbers:
        logger.error("No reference numbers found in file")
        return
    
    logger.info(f"📋 Loaded {len(ref_numbers)} reference numbers")
    
    scraper = TargetedScraperV2(
        ref_numbers=ref_numbers,
        worker_id=args.worker_id,
        delay_seconds=args.delay,
        headless=args.headless
    )
    
    await scraper.run()


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())