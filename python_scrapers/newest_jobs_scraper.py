import asyncio
import logging
import sys
from datetime import datetime
from typing import List, Dict, Any

from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class NewestJobsScraper(BaseScraper):
    """Scraper for newest jobs without emails, one per employer"""
    
    def __init__(self, process_id=None):
        # Use provided process_id or generate one based on PID, timestamp, and random value
        if process_id is None:
            import os
            import time
            import random
            process_id = f"{os.getpid()}-{int(time.time())}-{random.randint(1000, 9999)}"
        
        super().__init__('newest-jobs', process_id=process_id)
        self.batch_size = 10
        self.delay_between_requests = 15  # seconds - increased to avoid rate limiting
        self.initial_delay = 20  # seconds - wait before first request
        
    async def get_jobs_to_scrape(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get newest jobs that need detail scraping (no external URLs, not yet scraped)"""
        query = """
            WITH employers_with_emails AS (
              SELECT DISTINCT arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 
              WHERE (email IS NOT NULL AND email != '') 
                 OR (new_email IS NOT NULL AND new_email != '')
            ),
            employers_with_job_details AS (
              SELECT DISTINCT j.arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 j
              INNER JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
              WHERE jd.has_emails = true
            ),
            employers_with_external_urls AS (
              SELECT DISTINCT arbeitgeber
              FROM job_scrp_arbeitsagentur_jobs_v2 
              WHERE externeurl IS NOT NULL AND externeurl != ''
            ),
            recent_jobs AS (
              SELECT 
                j.id,
                j.refnr,
                j.titel,
                j.arbeitgeber,
                j.arbeitsort_ort,
                j.aktuelleveroeffentlichungsdatum,
                ROW_NUMBER() OVER (PARTITION BY j.arbeitgeber ORDER BY j.aktuelleveroeffentlichungsdatum DESC, j.id DESC) as rn
              FROM job_scrp_arbeitsagentur_jobs_v2 j
              LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
              WHERE j.refnr IS NOT NULL
                AND (j.externeurl IS NULL OR j.externeurl = '')
                AND (j.email IS NULL OR j.email = '')
                AND (j.new_email IS NULL OR j.new_email = '')
                AND jd.reference_number IS NULL
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_emails)
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_job_details)
                AND j.arbeitgeber NOT IN (SELECT arbeitgeber FROM employers_with_external_urls)
            )
            SELECT 
                id, refnr, titel, arbeitgeber, arbeitsort_ort, aktuelleveroeffentlichungsdatum
            FROM recent_jobs 
            WHERE rn = 1
            ORDER BY aktuelleveroeffentlichungsdatum DESC, refnr DESC
            LIMIT %s
        """
        
        self.db_cursor.execute(query, (limit,))
        jobs = self.db_cursor.fetchall()
        
        logger.info(f"📋 Found {len(jobs)} jobs ready for detail scraping (newest first, one per employer)")
        return jobs
        
    def construct_job_url(self, refnr: str) -> str:
        """Construct Arbeitsagentur detail URL from reference number"""
        return f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}"
        
    async def save_job_details(self, job: Dict[str, Any], email_data: Dict[str, Any], success: bool):
        """Save job details and update employer information"""
        refnr = job['refnr']
        
        try:
            # Insert into job_details
            insert_query = """
                INSERT INTO job_scrp_job_details (
                    reference_number, scraped_at, scraping_success,
                    has_emails, contact_emails, best_email,
                    company_domain, email_count, scraping_error,
                    detail_page_email, email_source
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
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
                    detail_page_email = EXCLUDED.detail_page_email,
                    email_source = EXCLUDED.email_source,
                    updated_at = CURRENT_TIMESTAMP
            """
            
            self.db_cursor.execute(insert_query, (
                refnr,
                datetime.now(),
                success,
                email_data.get('has_emails', False),
                ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                email_data.get('primary_email'),
                email_data.get('primary_domain'),
                email_data.get('email_count', 0),
                None if success else 'Scraping failed',
                email_data.get('primary_email'),
                'detail_page' if email_data.get('has_emails') else None
            ))
            
            # Update employer if emails found
            if email_data.get('has_emails'):
                update_employer_query = """
                    UPDATE job_scrp_employers 
                    SET contact_emails = %s,
                        website = %s,
                        email_extraction_date = %s,
                        email_extraction_attempted = true
                    WHERE name = %s
                """
                
                self.db_cursor.execute(update_employer_query, (
                    ','.join(email_data.get('emails', [])),
                    email_data.get('primary_domain'),
                    datetime.now(),
                    job['arbeitgeber']
                ))
                
                logger.info(f"🏢 Updated employer \"{job['arbeitgeber']}\" with emails")
            
            self.db_conn.commit()
            logger.info(f"💾 Saved results for {refnr}")
            
        except Exception as e:
            self.db_conn.rollback()
            logger.error(f"Database error: {e}")
            
    async def mark_job_inactive(self, job_id: int):
        """Mark job as inactive when 404 detected"""
        try:
            query = """
                UPDATE job_scrp_arbeitsagentur_jobs_v2 
                SET is_active = false,
                    marked_inactive_date = %s
                WHERE id = %s
            """
            self.db_cursor.execute(query, (datetime.now(), job_id))
            self.db_conn.commit()
            logger.info(f"📍 Marked job {job_id} as inactive")
        except Exception as e:
            self.db_conn.rollback()
            logger.error(f"Error marking job inactive: {e}")
            
    async def scrape_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Scrape a single job"""
        url = self.construct_job_url(job['refnr'])
        logger.info(f"🔍 Scraping: {job['titel']} - {job['arbeitgeber']}")
        logger.info(f"🔗 URL: {url}")
        
        try:
            # Navigate to job page
            success = await self.navigate_to_job(url)
            
            if not success:
                # Job no longer exists (404)
                await self.mark_job_inactive(job['id'])
                return {
                    'success': False,
                    'has_emails': False,
                    'reason': '404 - Job no longer exists'
                }
            
            # Extract emails
            email_data = await self.extract_emails_from_page(job['arbeitgeber'])
            
            # Save results
            await self.save_job_details(job, email_data, True)
            
            return {
                'success': True,
                'has_emails': email_data['has_emails'],
                'email_count': email_data['email_count']
            }
            
        except Exception as e:
            logger.error(f"❌ Error scraping {job['refnr']}: {e}")
            await self.save_job_details(job, {}, False)
            return {
                'success': False,
                'has_emails': False,
                'reason': str(e)
            }
            
    async def run(self, limit: int = None):
        """Main scraping loop"""
        if limit is None:
            limit = self.batch_size
            
        logger.info(f"🚀 Starting Newest Jobs Scraper for up to {limit} jobs")
        logger.info("📧 Focus: Extract emails from newest jobs without external URLs")
        logger.info("🚫 Excluded: Jobs with external URLs, arbeitsagentur emails, already scraped employers")
        
        # Get jobs to scrape
        jobs = await self.get_jobs_to_scrape(limit)
        
        if not jobs:
            logger.info("📭 No jobs to scrape")
            return
            
        # Initial delay to appear more human-like and avoid rate limiting
        logger.info(f"⏳ Waiting {self.initial_delay} seconds before starting scraping...")
        await asyncio.sleep(self.initial_delay)
            
        # Process jobs
        total_jobs = len(jobs)
        successful = 0
        with_emails = 0
        
        for i, job in enumerate(jobs, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"Processing job {i}/{total_jobs}")
            
            result = await self.scrape_job(job)
            
            if result['success']:
                successful += 1
                if result['has_emails']:
                    with_emails += 1
                    
            # Delay between requests
            if i < total_jobs:
                await asyncio.sleep(self.delay_between_requests)
                
        # Summary
        logger.info(f"\n{'='*60}")
        logger.info("🎉 Scraping completed!")
        logger.info(f"📊 Final Stats:")
        logger.info(f"   Total jobs processed: {total_jobs}")
        logger.info(f"   Successful scrapes: {successful}")
        logger.info(f"   Jobs with emails found: {with_emails}")
        logger.info(f"   Success rate: {successful/total_jobs*100:.1f}%")
        logger.info(f"   Email discovery rate: {with_emails/total_jobs*100:.1f}%")
        
        # Keep browser open for inspection
        logger.info("\n🌐 Keeping browser open. Press Ctrl+C to close...")
        try:
            await asyncio.sleep(86400)  # Keep open for 24 hours
        except KeyboardInterrupt:
            logger.info("\n👋 Closing browser...")


async def main():
    """Main entry point"""
    # Get limit from command line
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    
    async with NewestJobsScraper() as scraper:
        await scraper.run(limit)


if __name__ == '__main__':
    asyncio.run(main())