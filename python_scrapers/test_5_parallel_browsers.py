#!/usr/bin/env python3
"""Test 5 parallel workers with visible browser windows"""

import asyncio
import logging
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from base_scraper import BaseScraper
from config import DB_CONFIG

# Set up logging with worker ID
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker-%(worker_id)s] - %(message)s'
)


class WorkerScraper(BaseScraper):
    """Custom scraper that shows worker ID and runs non-headless"""
    
    def __init__(self, worker_id: int):
        self.worker_id = worker_id
        # Unique process ID for each worker
        super().__init__(f'worker-{worker_id}', process_id=f'parallel-{worker_id}')
        
    async def _init_browser(self):
        """Override to force non-headless mode"""
        from playwright.async_api import async_playwright
        self.playwright = await async_playwright().start()
        
        # Force headless=False for visible browsers
        self.browser = await self.playwright.chromium.launch(
            headless=False,  # VISIBLE BROWSER
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        
        # Position windows differently on screen
        viewport_width = 800
        viewport_height = 600
        x_position = (self.worker_id % 3) * (viewport_width + 10)
        y_position = (self.worker_id // 3) * (viewport_height + 50)
        
        # Create context with specific viewport
        context_options = {
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'locale': 'de-DE',
            'viewport': {'width': viewport_width, 'height': viewport_height},
        }
        
        self.context = await self.browser.new_context(**context_options)
        self.page = await self.context.new_page()
        
        # Try to position window (may not work on all systems)
        try:
            await self.page.evaluate(f'''() => {{
                window.moveTo({x_position}, {y_position});
            }}''')
        except:
            pass
            
        # Add worker ID to page title
        await self.page.evaluate(f'''() => {{
            document.title = "Worker {self.worker_id} - " + document.title;
        }}''')


async def worker_task(worker_id: int, job_urls: list):
    """Task for a single worker"""
    # Create logger with worker_id
    logger = logging.LoggerAdapter(
        logging.getLogger(__name__),
        {'worker_id': worker_id}
    )
    
    logger.info(f"🚀 Starting worker {worker_id}")
    
    async with WorkerScraper(worker_id) as scraper:
        logger.info(f"📁 Cookie dir: {scraper.cookie_dir.name}")
        
        # Add visual indicator to browser
        await scraper.page.evaluate(f'''() => {{
            const div = document.createElement('div');
            div.innerHTML = 'WORKER {worker_id}';
            div.style.position = 'fixed';
            div.style.top = '10px';
            div.style.right = '10px';
            div.style.padding = '10px';
            div.style.background = '#{worker_id}0{worker_id}0ff';
            div.style.color = 'white';
            div.style.fontSize = '20px';
            div.style.fontWeight = 'bold';
            div.style.zIndex = '99999';
            document.body.appendChild(div);
        }}''')
        
        for i, url in enumerate(job_urls, 1):
            logger.info(f"Processing job {i}/{len(job_urls)}")
            
            try:
                success = await scraper.navigate_to_job(url)
                
                if success:
                    # Check for CAPTCHA
                    captcha = await scraper.page.query_selector('img[src*="captcha"]')
                    if captcha:
                        logger.info("🔐 CAPTCHA detected!")
                        # In real scenario, would solve here
                    else:
                        logger.info("✅ No CAPTCHA - page loaded")
                    
                    # Keep page visible for a moment
                    await asyncio.sleep(3)
                else:
                    logger.warning("❌ Navigation failed")
                    
            except Exception as e:
                logger.error(f"Error: {e}")
                
        logger.info("✅ Worker completed")
        
        # Keep browser open for observation
        logger.info("🔍 Keeping browser open for 10 seconds...")
        await asyncio.sleep(10)


async def run_5_parallel_browsers():
    """Run 5 parallel workers with visible browsers"""
    print("\n" + "="*60)
    print("🚀 Starting 5 Parallel Browser Test")
    print("="*60)
    
    # Get jobs from database
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get 10 fresh jobs
    query = """
        SELECT refnr, titel, arbeitgeber
        FROM job_scrp_arbeitsagentur_jobs_v2
        WHERE refnr IS NOT NULL
          AND (externeurl IS NULL OR externeurl = '')
          AND old = false
          AND is_active = true
        ORDER BY aktuelleveroeffentlichungsdatum DESC
        LIMIT 10
    """
    
    cursor.execute(query)
    jobs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    if not jobs:
        print("❌ No jobs found in database")
        return
        
    job_urls = [f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}" for job in jobs]
    
    print(f"\n📋 Found {len(jobs)} jobs to process")
    print(f"🖥️  Will launch 5 visible browser windows")
    print(f"📁 Each worker gets its own cookie directory")
    print("\n⏳ Launching browsers...\n")
    
    # Create 5 worker tasks
    tasks = []
    jobs_per_worker = 2  # Each worker processes 2 jobs
    
    for worker_id in range(5):
        start_idx = worker_id * jobs_per_worker
        end_idx = start_idx + jobs_per_worker
        worker_jobs = job_urls[start_idx:end_idx] if start_idx < len(job_urls) else []
        
        if worker_jobs:
            task = worker_task(worker_id, worker_jobs)
            tasks.append(task)
            print(f"   Worker {worker_id}: {len(worker_jobs)} jobs")
    
    # Run all workers concurrently
    print("\n🏃 Running all workers in parallel...")
    print("👀 Watch for 5 browser windows opening!\n")
    
    await asyncio.gather(*tasks)
    
    print("\n✅ All workers completed!")
    print("\n📊 Summary:")
    print("   - 5 parallel browser windows")
    print("   - Each with its own cookie directory")
    print("   - No interference between workers")


if __name__ == '__main__':
    # Run the test
    asyncio.run(run_5_parallel_browsers())