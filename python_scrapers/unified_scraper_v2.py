#!/usr/bin/env python3
"""
Unified Scraper V2 - Simplified version that extends BaseScraper
Handles employer-based job scraping with atomic claiming
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

from base_scraper import BaseScraper
from config import DB_CONFIG

logger = logging.getLogger(__name__)


class UnifiedScraperV2(BaseScraper):
    """Unified scraper that processes employers atomically"""
    
    def __init__(self, worker_id: int = 0, mode: str = 'batch', 
                 batch_size: int = 50, delay_seconds: int = 0, headless: bool = True):
        super().__init__(f'unified-v2-{worker_id}', worker_id)
        
        self.mode = mode
        self.batch_size = batch_size
        self.delay_seconds = delay_seconds
        self.headless = headless
        
    def claim_next_employer(self) -> Optional[Dict[str, Any]]:
        """Atomically claim next employer for processing"""
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            # Single atomic query that claims employer and returns job info
            query = """
                WITH claimed_employer AS (
                    UPDATE job_scrp_employers 
                    SET email_extraction_attempted = true,
                        email_extraction_date = NOW()
                    WHERE id IN (
                        SELECT e.id 
                        FROM job_scrp_employers e
                        WHERE e.email_extraction_attempted = false
                        ORDER BY e.id DESC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, name
                )
                SELECT 
                    ce.name as employer_name,
                    j.refnr,
                    j.titel
                FROM claimed_employer ce
                JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.arbeitgeber = ce.name
                WHERE j.is_active = true
                ORDER BY j.aktuelleveroeffentlichungsdatum DESC
                LIMIT 1
            """
            
            cursor.execute(query)
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return dict(result)
            return None
            
        except Exception as e:
            logger.error(f"Error claiming employer: {e}")
            conn.rollback()
            return None
        finally:
            cursor.close()
            conn.close()
            
    def save_results(self, employer_name: str, refnr: str, email_data: Dict[str, Any], success: bool):
        """Save scraping results to database"""
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        try:
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
                None if success else 'Scraping failed',
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
            
    async def process_job(self, employer_name: str, refnr: str, job_title: str) -> Dict[str, Any]:
        """Process a single job"""
        url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}"
        
        # Navigate to job
        success = await self.navigate_to_job(url)
        
        if not success:
            logger.warning(f"💀 404 error for {employer_name}")
            return {'success': False, 'error': '404', 'has_emails': False}
            
        # Extract emails
        email_data = await self.extract_emails_from_page(employer_name)
        
        # Check for external URL and domain
        try:
            external_link = await self.page.query_selector('a#detail-bewerbung-url[href*="jobexport.de"]')
            if external_link:
                external_url = await external_link.get_attribute('href')
                if external_url:
                    # Follow redirect to get actual domain
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
        """Main execution loop"""
        await self.initialize()
        
        logger.info(f"🚀 Worker {self.worker_id} starting in {self.mode} mode")
        jobs_processed = 0
        
        try:
            while True:
                # Claim next employer
                claim = self.claim_next_employer()
                
                if not claim:
                    if self.mode == 'batch':
                        logger.info("No more employers to process")
                        break
                    else:  # continuous mode
                        logger.info("No employers available, waiting...")
                        await asyncio.sleep(30)
                        continue
                        
                employer_name = claim['employer_name']
                refnr = claim['refnr']
                job_title = claim['titel']
                
                self.processed_count += 1
                jobs_processed += 1
                
                logger.info(f"\n{'='*60}")
                logger.info(f"[{self.processed_count}] Processing: {employer_name[:50]}...")
                logger.info(f"📋 Job: {job_title[:50]}...")
                
                # Process the job
                result = await self.process_job(employer_name, refnr, job_title)
                
                if result['success']:
                    self.success_count += 1
                    if result.get('has_emails'):
                        self.email_count += 1
                        logger.info(f"📧 Found emails: {result['emails']}")
                    else:
                        logger.info("📭 No emails found")
                else:
                    logger.warning(f"❌ Failed: {result.get('error', 'Unknown error')}")
                
                # Save results
                self.save_results(employer_name, refnr, result, result['success'])
                
                # Check batch limit
                if self.mode == 'batch' and jobs_processed >= self.batch_size:
                    logger.info(f"Batch limit reached ({self.batch_size})")
                    break
                    
                # Delay between requests
                if self.delay_seconds > 0:
                    await asyncio.sleep(self.delay_seconds)
                    
        finally:
            await self.cleanup()
            
        # Summary
        logger.info(f"\n{'='*60}")
        logger.info(f"🎯 Worker {self.worker_id} Summary:")
        logger.info(f"   Processed: {self.processed_count}")
        logger.info(f"   Successful: {self.success_count}")
        logger.info(f"   With emails: {self.email_count}")
        if self.processed_count > 0:
            logger.info(f"   Success rate: {self.email_count/self.processed_count*100:.1f}%")


async def main():
    """Main entry point"""
    import argparse
    parser = argparse.ArgumentParser(description='Unified scraper V2')
    parser.add_argument('--worker-id', type=int, default=0, help='Worker ID')
    parser.add_argument('--mode', choices=['batch', 'continuous'], default='batch')
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--delay', type=int, default=0)
    parser.add_argument('--headless', action='store_true')
    
    args = parser.parse_args()
    
    scraper = UnifiedScraperV2(
        worker_id=args.worker_id,
        mode=args.mode,
        batch_size=args.batch_size,
        delay_seconds=args.delay,
        headless=args.headless
    )
    
    await scraper.run()


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())