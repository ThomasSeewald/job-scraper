#!/usr/bin/env python3
"""Run 5 parallel historical scrapers with different employers"""

import asyncio
import logging
import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor

from base_scraper import BaseScraper
from config import DB_CONFIG

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(message)s'
)


class ParallelHistoricalScraper(BaseScraper):
    """Fast historical scraper for parallel execution"""
    
    def __init__(self, worker_id: int):
        self.worker_id = worker_id
        super().__init__(f'parallel-historical-{worker_id}', process_id=f'worker-{worker_id}')
        # Faster settings for parallel execution
        self.delay_between_requests = 3  # Only 3 seconds between jobs


async def worker_task(worker_id: int, employers: List[Dict], progress_tracker: Dict):
    """Worker task for processing employers"""
    
    logger = logging.LoggerAdapter(
        logging.getLogger(__name__),
        {'worker_id': worker_id}
    )
    
    logger.info(f"🚀 Starting worker {worker_id} with {len(employers)} employers")
    
    async with ParallelHistoricalScraper(worker_id) as scraper:
        logger.info(f"📁 Cookie dir: {scraper.cookie_dir.name}")
        
        successful = 0
        with_emails = 0
        
        for i, employer in enumerate(employers, 1):
            logger.info(f"\n{'='*40}")
            logger.info(f"Employer {i}/{len(employers)}: {employer['name'][:50]}...")
            
            try:
                # Get a job for this employer
                scraper.db_cursor.execute("""
                    SELECT refnr, titel FROM job_scrp_arbeitsagentur_jobs_v2
                    WHERE arbeitgeber = %s 
                    AND refnr IS NOT NULL
                    ORDER BY aktuelleveroeffentlichungsdatum DESC
                    LIMIT 1
                """, (employer['name'],))
                
                job = scraper.db_cursor.fetchone()
                if not job:
                    logger.warning(f"❌ No job found for employer")
                    continue
                
                url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
                logger.info(f"📋 Job: {job['titel'][:50]}...")
                
                # Navigate to job
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ 404 error")
                    # Update employer as attempted
                    scraper.db_cursor.execute("""
                        UPDATE job_scrp_employers 
                        SET email_extraction_attempted = true,
                            email_extraction_date = %s
                        WHERE id = %s
                    """, (datetime.now(), employer['id']))
                    scraper.db_conn.commit()
                    continue
                
                successful += 1
                
                # Extract emails
                email_data = await scraper.extract_emails_from_page(employer['name'])
                
                if email_data['has_emails']:
                    with_emails += 1
                    logger.info(f"📧 Found emails: {email_data['emails']}")
                else:
                    logger.info("📭 No emails found")
                
                # Update employer
                scraper.db_cursor.execute("""
                    UPDATE job_scrp_employers 
                    SET contact_emails = %s,
                        website = %s,
                        email_extraction_date = %s,
                        email_extraction_attempted = true
                    WHERE id = %s
                """, (
                    ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                    email_data.get('primary_domain'),
                    datetime.now(),
                    employer['id']
                ))
                scraper.db_conn.commit()
                
                # Update progress
                progress_tracker['total'] += 1
                if email_data['has_emails']:
                    progress_tracker['with_emails'] += 1
                
                # Quick delay between employers (3 seconds)
                if i < len(employers):
                    await asyncio.sleep(scraper.delay_between_requests)
                    
            except Exception as e:
                logger.error(f"Error: {e}")
                
        logger.info(f"\n✅ Worker {worker_id} completed: {successful} successful, {with_emails} with emails")


async def run_parallel_scrapers(total_employers: int = 25):
    """Run 5 parallel scrapers"""
    
    print("\n" + "="*60)
    print("🚀 Starting 5 Parallel Historical Scrapers")
    print("🖥️  Each worker will open its own browser window")
    print("="*60)
    
    # Get employers to process
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get employers that haven't been attempted
    cursor.execute("""
        SELECT DISTINCT ON (e.name) 
            e.id, e.name
        FROM job_scrp_employers e
        WHERE e.email_extraction_attempted = false
          AND e.name IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM job_scrp_arbeitsagentur_jobs_v2 j
              WHERE j.arbeitgeber = e.name 
              AND j.refnr IS NOT NULL
              LIMIT 1
          )
        ORDER BY e.name, e.id
        LIMIT %s
    """, (total_employers,))
    
    employers = cursor.fetchall()
    cursor.close()
    conn.close()
    
    if not employers:
        print("❌ No employers to process")
        return
    
    print(f"📋 Found {len(employers)} employers to process")
    print(f"🖥️  Launching 5 parallel browser windows")
    print(f"⚡ Fast mode: Only 3 seconds between jobs")
    
    # Split employers among workers
    num_workers = min(5, len(employers))  # Max 5 workers
    employers_per_worker = len(employers) // num_workers
    remainder = len(employers) % num_workers
    
    # Track progress
    progress_tracker = {'total': 0, 'with_emails': 0}
    
    # Create worker tasks
    tasks = []
    start_idx = 0
    
    for worker_id in range(num_workers):
        # Distribute employers evenly
        count = employers_per_worker + (1 if worker_id < remainder else 0)
        worker_employers = employers[start_idx:start_idx + count]
        start_idx += count
        
        if worker_employers:
            print(f"\n   Worker {worker_id}: {len(worker_employers)} employers")
            for emp in worker_employers[:3]:  # Show first 3
                print(f"      - {emp['name'][:50]}...")
            if len(worker_employers) > 3:
                print(f"      ... and {len(worker_employers) - 3} more")
            
            task = worker_task(worker_id, worker_employers, progress_tracker)
            tasks.append(task)
    
    print(f"\n⏳ Starting {num_workers} workers in parallel...\n")
    
    # Run all workers concurrently
    await asyncio.gather(*tasks)
    
    # Summary
    print(f"\n{'='*60}")
    print("🎯 All workers completed!")
    print(f"📊 Total results:")
    print(f"   - Employers processed: {progress_tracker['total']}")
    print(f"   - Employers with emails: {progress_tracker['with_emails']}")
    if progress_tracker['total'] > 0:
        print(f"   - Success rate: {progress_tracker['with_emails']/progress_tracker['total']*100:.1f}%")
    
    print("\n🌐 Browsers will stay open. Press Ctrl+C to close all.")
    try:
        await asyncio.sleep(86400)  # 24 hours
    except KeyboardInterrupt:
        print("\n👋 Closing all browsers...")


if __name__ == '__main__':
    import sys
    total = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    
    try:
        asyncio.run(run_parallel_scrapers(total))
    except KeyboardInterrupt:
        print("\n✅ Parallel scraping completed!")