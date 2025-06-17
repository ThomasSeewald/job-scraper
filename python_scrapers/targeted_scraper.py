#!/usr/bin/env python3
"""Targeted scraper for specific job reference numbers using the unified scraper infrastructure"""

import asyncio
import logging
import sys
import argparse
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

from unified_scraper import UnifiedScraper
from config import DB_CONFIG

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TargetedScraper(UnifiedScraper):
    """Modified scraper that processes specific reference numbers"""
    
    def __init__(self, ref_numbers: List[str], **kwargs):
        super().__init__(**kwargs)
        self.ref_numbers = ref_numbers
        self.current_index = 0
    
    async def claim_next_employer(self) -> Optional[Dict[str, Any]]:
        """Get next job from the targeted list"""
        if self.current_index >= len(self.ref_numbers):
            return None
            
        refnr = self.ref_numbers[self.current_index]
        self.current_index += 1
        
        logger.info(f"🎯 Processing targeted job {self.current_index}/{len(self.ref_numbers)}: {refnr}")
        
        # Get job details from database
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
        
        try:
            # Create proper connection string from DB_CONFIG
            conn_str = f"host={DB_CONFIG['host']} port={DB_CONFIG['port']} dbname={DB_CONFIG['database']} user={DB_CONFIG['user']} password={DB_CONFIG['password']}"
            with psycopg2.connect(conn_str) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
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
    
    async def run(self):
        """Run targeted extraction"""
        await self.initialize_browser()
        
        logger.info(f"🚀 Starting targeted extraction for {len(self.ref_numbers)} jobs")
        
        jobs_processed = 0
        while jobs_processed < len(self.ref_numbers):
            job = await self.claim_next_employer()
            
            if not job:
                continue
                
            try:
                logger.info(f"📋 Processing: {job['titel']} @ {job['employer_name']}")
                result = await self.process_job(job['employer_name'], job['refnr'], job['titel'])
                
                # Save results to database - THIS WAS MISSING!
                self.save_results(job['employer_name'], job['refnr'], result, result.get('success', False))
                
                if result.get('emails'):
                    logger.info(f"✅ Found {len(result['emails'])} emails")
                    self.email_count += len(result['emails'])
                    self.success_count += 1
                else:
                    logger.info(f"❌ No emails found")
                
                self.processed_count += 1
                jobs_processed += 1
                
                # Add delay between jobs
                if self.delay_seconds > 0 and jobs_processed < len(self.ref_numbers):
                    logger.info(f"⏳ Waiting {self.delay_seconds} seconds...")
                    await asyncio.sleep(self.delay_seconds)
                    
            except Exception as e:
                logger.error(f"❌ Error processing job: {e}")
                jobs_processed += 1
        
        # Final stats
        logger.info(f"""
        ✅ Targeted extraction complete!
        📊 Stats:
        - Jobs processed: {self.processed_count}
        - Successful: {self.success_count}
        - Total emails found: {self.email_count}
        """)


async def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description='Targeted scraper for specific job reference numbers')
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
        sys.exit(1)
    
    if not ref_numbers:
        logger.error("No reference numbers found in file")
        sys.exit(1)
    
    logger.info(f"📋 Loaded {len(ref_numbers)} reference numbers")
    
    scraper = TargetedScraper(
        ref_numbers=ref_numbers,
        worker_id=args.worker_id,
        mode='batch',
        batch_size=len(ref_numbers),
        delay_seconds=args.delay,
        headless=args.headless
    )
    
    try:
        await scraper.run()
    finally:
        await scraper.cleanup()


if __name__ == '__main__':
    asyncio.run(main())