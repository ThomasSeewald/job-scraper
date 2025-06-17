import asyncio
import logging
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class HistoricalEmployerScraper(BaseScraper):
    """Scraper for historical employers that have never been scraped for emails"""
    
    def __init__(self, process_id=None):
        # Use provided process_id or generate one based on PID, timestamp, and random value
        if process_id is None:
            import os
            import time
            import random
            process_id = f"{os.getpid()}-{int(time.time())}-{random.randint(1000, 9999)}"
        
        super().__init__('historical-employer', process_id=process_id)
        self.batch_size = 30  # Slower pace for historical data
        self.delay_between_requests = 15  # seconds - even slower for historical data
        self.progress_file = Path(__file__).parent.parent / 'historical-progress.json'
        
    def get_progress(self) -> Dict[str, Any]:
        """Get or load progress tracking"""
        try:
            if self.progress_file.exists():
                with open(self.progress_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"Error reading progress file: {e}")
            
        return {
            'lastProcessedId': 0,
            'totalProcessed': 0,
            'successfulExtractions': 0,
            'startDate': datetime.now().isoformat()
        }
        
    def save_progress(self, progress: Dict[str, Any]):
        """Save progress to file"""
        with open(self.progress_file, 'w') as f:
            json.dump(progress, f, indent=2)
            
    async def get_historical_employers_batch(self) -> List[Dict[str, Any]]:
        """Get next batch of historical employers to scrape"""
        progress = self.get_progress()
        
        query = """
            WITH employer_newest_jobs AS (
                SELECT 
                    e.id,
                    e.name,
                    e.normalized_name,
                    j.refnr,
                    j.titel,
                    j.arbeitsort_ort,
                    ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY j.aktuelleveroeffentlichungsdatum DESC) as rn
                FROM job_scrp_employers e
                INNER JOIN job_scrp_arbeitsagentur_jobs_v2 j ON j.arbeitgeber = e.name
                WHERE e.email_extraction_attempted = false
                  AND e.id > %s
                  AND j.refnr IS NOT NULL
                  AND (j.externeurl IS NULL OR j.externeurl = '')
                ORDER BY e.id
            )
            SELECT 
                id, name, normalized_name, refnr, titel, arbeitsort_ort
            FROM employer_newest_jobs
            WHERE rn = 1
            ORDER BY id
            LIMIT %s
        """
        
        self.db_cursor.execute(query, (progress['lastProcessedId'], self.batch_size))
        employers = self.db_cursor.fetchall()
        
        logger.info(f"📋 Found {len(employers)} historical employers to process")
        return employers
        
    async def save_employer_results(self, employer: Dict[str, Any], email_data: Dict[str, Any], success: bool):
        """Save scraping results for employer"""
        try:
            # Update employer record
            update_query = """
                UPDATE job_scrp_employers 
                SET email_extraction_attempted = true,
                    email_extraction_date = %s,
                    contact_emails = %s,
                    website = %s
                WHERE id = %s
            """
            
            self.db_cursor.execute(update_query, (
                datetime.now(),
                ','.join(email_data.get('emails', [])) if email_data.get('has_emails') else None,
                email_data.get('primary_domain'),
                employer['id']
            ))
            
            # Also save to job_details for the job we scraped
            if employer.get('refnr'):
                job_details_query = """
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
                """
                
                self.db_cursor.execute(job_details_query, (
                    employer['refnr'],
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
            
            self.db_conn.commit()
            
            if email_data.get('has_emails'):
                logger.info(f"✅ Found {email_data['email_count']} emails for {employer['name']}")
            else:
                logger.info(f"📭 No emails found for {employer['name']}")
                
        except Exception as e:
            self.db_conn.rollback()
            logger.error(f"Database error: {e}")
            
    async def mark_job_inactive_if_404(self, refnr: str):
        """Mark job as inactive if it's a 404"""
        try:
            query = """
                UPDATE job_scrp_arbeitsagentur_jobs_v2 
                SET is_active = false,
                    marked_inactive_date = %s
                WHERE refnr = %s
            """
            self.db_cursor.execute(query, (datetime.now(), refnr))
            self.db_conn.commit()
            logger.info(f"📍 Marked job {refnr} as inactive")
        except Exception as e:
            self.db_conn.rollback()
            logger.error(f"Error marking job inactive: {e}")
            
    async def scrape_employer(self, employer: Dict[str, Any]) -> Dict[str, Any]:
        """Scrape a single employer"""
        url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{employer['refnr']}"
        logger.info(f"🔍 Processing: {employer['name']} (ID: {employer['id']})")
        logger.info(f"📋 Job: {employer['titel']}")
        logger.info(f"🔗 URL: {url}")
        
        try:
            # Navigate to job page (includes 404 check and CAPTCHA handling)
            success = await self.navigate_to_job(url)
            
            if not success:
                # Job no longer exists (404)
                await self.mark_job_inactive_if_404(employer['refnr'])
                return {
                    'success': False,
                    'has_emails': False,
                    'reason': '404 - Job no longer exists'
                }
            
            # Extract emails (base class method)
            email_data = await self.extract_emails_from_page(employer['name'])
            
            # Save results
            await self.save_employer_results(employer, email_data, True)
            
            return {
                'success': True,
                'has_emails': email_data['has_emails'],
                'email_count': email_data['email_count']
            }
            
        except Exception as e:
            logger.error(f"❌ Error scraping employer {employer['name']}: {e}")
            await self.save_employer_results(employer, {}, False)
            return {
                'success': False,
                'has_emails': False,
                'reason': str(e)
            }
            
    async def run(self, limit: int = None):
        """Main scraping loop"""
        if limit is None:
            limit = self.batch_size
            
        logger.info(f"🚀 Starting Historical Employer Scraper")
        logger.info(f"🎯 Target: Employers never attempted for email extraction")
        logger.info(f"📦 Batch size: {limit} employers")
        
        # Load progress
        progress = self.get_progress()
        logger.info(f"📊 Progress: {progress['totalProcessed']} employers processed since {progress['startDate']}")
        
        # Get employers to scrape
        employers = await self.get_historical_employers_batch()
        
        if not employers:
            logger.info("📭 No more historical employers to scrape")
            return
            
        # Process employers
        successful = 0
        with_emails = 0
        
        for i, employer in enumerate(employers[:limit], 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"Processing employer {i}/{min(len(employers), limit)}")
            
            result = await self.scrape_employer(employer)
            
            if result['success']:
                successful += 1
                if result['has_emails']:
                    with_emails += 1
                    progress['successfulExtractions'] += 1
                    
            # Update progress
            progress['lastProcessedId'] = employer['id']
            progress['totalProcessed'] += 1
            self.save_progress(progress)
            
            # Delay between requests
            if i < min(len(employers), limit):
                await asyncio.sleep(self.delay_between_requests)
                
        # Summary
        logger.info(f"\n{'='*60}")
        logger.info("🎉 Historical scraping batch completed!")
        logger.info(f"📊 Batch Stats:")
        logger.info(f"   Employers processed: {min(len(employers), limit)}")
        logger.info(f"   Successful scrapes: {successful}")
        logger.info(f"   Employers with emails: {with_emails}")
        logger.info(f"📊 Overall Progress:")
        logger.info(f"   Total processed: {progress['totalProcessed']}")
        logger.info(f"   Total with emails: {progress['successfulExtractions']}")
        logger.info(f"   Success rate: {progress['successfulExtractions']/progress['totalProcessed']*100:.1f}%")
        
        # Keep browser open for inspection
        logger.info("\n🌐 Keeping browser open. Press Ctrl+C to close...")
        try:
            await asyncio.sleep(86400)  # Keep open for 24 hours
        except KeyboardInterrupt:
            logger.info("\n👋 Closing browser...")


async def main():
    """Main entry point"""
    # Get limit from command line
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    
    async with HistoricalEmployerScraper() as scraper:
        await scraper.run(limit)


if __name__ == '__main__':
    asyncio.run(main())