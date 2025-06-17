#!/usr/bin/env python3
"""Fixed parallel historical scraper with separate browser windows"""

import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor
from playwright.async_api import async_playwright

from config import DB_CONFIG, BROWSER_HEADLESS, BROWSER_TIMEOUT, COOKIE_BASE_DIR, CAPTCHA_API_KEY
from email_extractor import EmailExtractor
import aiohttp
import base64

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(message)s'
)


class WorkerScraper:
    """Individual worker scraper with its own browser"""
    
    def __init__(self, worker_id: int):
        self.worker_id = worker_id
        self.logger = logging.LoggerAdapter(
            logging.getLogger(__name__),
            {'worker_id': worker_id}
        )
        self.cookie_dir = COOKIE_BASE_DIR / f'worker-{worker_id}'
        self.cookie_dir.mkdir(exist_ok=True)
        self.state_file = self.cookie_dir / 'state.json'
        self.email_extractor = EmailExtractor()
        self.captcha_api_key = CAPTCHA_API_KEY
        self.delay_between_requests = 3  # Fast mode
        
    async def solve_captcha_on_page(self, page) -> bool:
        """Solve CAPTCHA if present"""
        try:
            # Check for CAPTCHA
            captcha_img = await page.query_selector('img[src*="/idaas/id-aas-service/ct/v1/captcha/"], img[src*="captcha"]')
            if not captcha_img:
                return True
                
            self.logger.info("🧩 CAPTCHA detected, solving...")
            
            # Get CAPTCHA image source
            captcha_src = await captcha_img.get_attribute('src')
            
            # Download and solve CAPTCHA
            solution = None
            try:
                if captcha_src.startswith('data:'):
                    image_data = captcha_src.split(',')[1]
                else:
                    # Download image
                    img_response = await page.evaluate(f'''
                        fetch("{captcha_src}")
                            .then(r => r.blob())
                            .then(blob => new Promise((resolve) => {{
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            }}))
                    ''')
                    image_data = img_response
                
                # Send to 2captcha
                async with aiohttp.ClientSession() as session:
                    submit_data = {
                        'key': self.captcha_api_key,
                        'method': 'base64',
                        'body': image_data,
                        'json': 1
                    }
                    
                    async with session.post('http://2captcha.com/in.php', data=submit_data) as resp:
                        result = await resp.json()
                        if result.get('status') == 1:
                            captcha_id = result['request']
                            
                            # Wait and get result
                            await asyncio.sleep(20)
                            
                            for attempt in range(10):
                                async with session.get(f'http://2captcha.com/res.php?key={self.captcha_api_key}&action=get&id={captcha_id}&json=1') as resp:
                                    result = await resp.json()
                                    if result.get('status') == 1:
                                        solution = result['request']
                                        self.logger.info(f"✅ CAPTCHA solved: {solution}")
                                        break
                                    elif result.get('request') != 'CAPCHA_NOT_READY':
                                        break
                                await asyncio.sleep(5)
            except Exception as e:
                self.logger.error(f"CAPTCHA solving error: {e}")
            
            if solution:
                # Enter solution
                captcha_input = await page.query_selector('#kontaktdaten-captcha-input')
                if captcha_input:
                    await captcha_input.fill(solution)
                    await page.wait_for_timeout(100)
                    
                    # Submit
                    submit_button = await page.query_selector('#kontaktdaten-captcha-absenden-button')
                    if submit_button:
                        await submit_button.click()
                        await page.wait_for_timeout(5000)
                        return True
                        
            return False
            
        except Exception as e:
            self.logger.error(f"CAPTCHA error: {e}")
            return False
        
    async def process_employers(self, employers: List[Dict]):
        """Process employers with own browser instance"""
        
        # Create own playwright instance
        playwright = await async_playwright().start()
        
        try:
            # Launch browser with visible window
            browser = await playwright.chromium.launch(
                headless=False,  # Always visible
                args=['--no-sandbox', '--disable-setuid-sandbox']
            )
            
            # Create context
            context_options = {
                'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
                'locale': 'de-DE',
                'viewport': {'width': 1200, 'height': 800}
            }
            
            # Load saved state if exists
            if self.state_file.exists():
                context_options['storage_state'] = str(self.state_file)
                
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            page.set_default_timeout(BROWSER_TIMEOUT)
            
            # Add worker ID indicator
            await page.add_init_script(f'''
                window.addEventListener('load', () => {{
                    const div = document.createElement('div');
                    div.innerHTML = 'WORKER {self.worker_id}';
                    div.style.position = 'fixed';
                    div.style.top = '10px';
                    div.style.right = '10px';
                    div.style.padding = '10px 20px';
                    div.style.background = 'darkblue';
                    div.style.color = 'white';
                    div.style.fontSize = '16px';
                    div.style.fontWeight = 'bold';
                    div.style.zIndex = '99999';
                    div.style.borderRadius = '5px';
                    document.body.appendChild(div);
                }});
            ''')
            
            # Database connection
            conn = psycopg2.connect(
                host=DB_CONFIG['host'],
                port=DB_CONFIG['port'],
                database=DB_CONFIG['database'],
                user=DB_CONFIG['user'],
                password=DB_CONFIG['password']
            )
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            successful = 0
            with_emails = 0
            
            for i, employer in enumerate(employers, 1):
                self.logger.info(f"\n{'='*40}")
                self.logger.info(f"Employer {i}/{len(employers)}: {employer['name'][:50]}...")
                
                try:
                    # Get job for employer
                    cursor.execute("""
                        SELECT refnr, titel FROM job_scrp_arbeitsagentur_jobs_v2
                        WHERE arbeitgeber = %s 
                        AND refnr IS NOT NULL
                        ORDER BY aktuelleveroeffentlichungsdatum DESC
                        LIMIT 1
                    """, (employer['name'],))
                    
                    job = cursor.fetchone()
                    if not job:
                        self.logger.warning("No job found")
                        continue
                        
                    url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
                    self.logger.info(f"📋 Job: {job['titel'][:50]}...")
                    
                    # Navigate
                    response = await page.goto(url, wait_until='domcontentloaded')
                    
                    if response and response.status == 404:
                        self.logger.warning("💀 404 error")
                        continue
                        
                    await page.wait_for_timeout(2000)
                    
                    # Handle cookies on first visit
                    cookie_button = await page.query_selector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]')
                    if cookie_button:
                        await cookie_button.click()
                        await page.wait_for_timeout(2000)
                        await context.storage_state(path=str(self.state_file))
                    
                    # Handle CAPTCHA
                    await self.solve_captcha_on_page(page)
                    
                    successful += 1
                    
                    # Extract emails
                    page_content = await page.content()
                    email_data = self.email_extractor.extract_from_page_content(page_content, employer['name'])
                    
                    if email_data['has_emails']:
                        with_emails += 1
                        self.logger.info(f"📧 Found emails: {email_data['emails']}")
                    else:
                        self.logger.info("📭 No emails found")
                        
                    # Update database
                    cursor.execute("""
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
                    conn.commit()
                    
                    # Delay between jobs
                    if i < len(employers):
                        await asyncio.sleep(self.delay_between_requests)
                        
                except Exception as e:
                    self.logger.error(f"Error: {e}")
                    
            self.logger.info(f"\n✅ Worker {self.worker_id} completed: {successful} successful, {with_emails} with emails")
            
            # Keep browser open
            self.logger.info("🌐 Browser staying open...")
            await asyncio.sleep(86400)
            
        finally:
            await browser.close()
            await playwright.stop()
            cursor.close()
            conn.close()


async def main(total_employers: int = 25):
    """Run 5 parallel workers with separate browsers"""
    
    print("\n" + "="*60)
    print("🚀 Starting 5 Parallel Historical Scrapers")
    print("🖥️  Opening 5 separate browser windows")
    print("="*60)
    
    # Get employers
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
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
    
    # Split among 5 workers
    num_workers = min(5, len(employers))
    employers_per_worker = len(employers) // num_workers
    remainder = len(employers) % num_workers
    
    # Create worker tasks
    tasks = []
    start_idx = 0
    
    for worker_id in range(num_workers):
        count = employers_per_worker + (1 if worker_id < remainder else 0)
        worker_employers = employers[start_idx:start_idx + count]
        start_idx += count
        
        if worker_employers:
            print(f"\n   Worker {worker_id}: {len(worker_employers)} employers")
            worker = WorkerScraper(worker_id)
            task = worker.process_employers(worker_employers)
            tasks.append(task)
            
    print(f"\n⏳ Launching {num_workers} browser windows...\n")
    
    # Run all workers
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n👋 Closing all browsers...")


if __name__ == '__main__':
    import sys
    total = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    
    try:
        asyncio.run(main(total))
    except KeyboardInterrupt:
        print("\n✅ Completed!")