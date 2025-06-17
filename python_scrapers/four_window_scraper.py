#!/usr/bin/env python3
"""Four window parallel scraper with database-driven coordination"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from playwright.async_api import async_playwright
import aiohttp

from config import DB_CONFIG, BROWSER_TIMEOUT, COOKIE_BASE_DIR, CAPTCHA_API_KEY
from email_extractor import EmailExtractor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(message)s'
)


class DatabaseWorkerScraper:
    """Worker scraper that uses database for coordination"""
    
    def __init__(self, worker_id: int):
        self.worker_id = worker_id
        self.logger = logging.LoggerAdapter(
            logging.getLogger(__name__),
            {'worker_id': worker_id}
        )
        
        # Worker-specific directories
        self.cookie_dir = COOKIE_BASE_DIR / f'4window-worker-{worker_id}'
        self.cookie_dir.mkdir(exist_ok=True)
        self.state_file = self.cookie_dir / 'state.json'
        
        # Tools
        self.email_extractor = EmailExtractor()
        self.captcha_api_key = CAPTCHA_API_KEY
        
        # Stats
        self.processed_count = 0
        self.success_count = 0
        self.email_count = 0
        
        # Window positions for 1920x1080 screen split into 4
        self.window_positions = [
            {'x': 0, 'y': 0},        # Top-left
            {'x': 960, 'y': 0},      # Top-right  
            {'x': 0, 'y': 540},      # Bottom-left
            {'x': 960, 'y': 540}     # Bottom-right
        ]
        
        # Worker colors
        self.worker_colors = ['red', 'blue', 'green', 'orange']
        
    def get_next_job_from_db(self) -> Optional[Dict[str, Any]]:
        """Get next unprocessed job from database with locking"""
        conn = None
        try:
            conn = psycopg2.connect(
                host=DB_CONFIG['host'],
                port=DB_CONFIG['port'],
                database=DB_CONFIG['database'],
                user=DB_CONFIG['user'],
                password=DB_CONFIG['password']
            )
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Get next job with row-level locking
            cursor.execute("""
                WITH eligible_jobs AS (
                    SELECT j.refnr, j.arbeitgeber, j.titel, j.arbeitsort_ort,
                           j.aktuelleveroeffentlichungsdatum
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                    WHERE j.refnr IS NOT NULL
                      AND (j.externeurl IS NULL OR j.externeurl = '')
                      AND (j.email IS NULL OR j.email = '')
                      AND jd.reference_number IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM job_scrp_employers e 
                          WHERE e.name = j.arbeitgeber 
                          AND e.email_extraction_attempted = true
                      )
                    ORDER BY j.aktuelleveroeffentlichungsdatum DESC
                    LIMIT 100
                ),
                selected_job AS (
                    SELECT * FROM eligible_jobs
                    ORDER BY aktuelleveroeffentlichungsdatum DESC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                SELECT * FROM selected_job;
            """)
            
            job = cursor.fetchone()
            
            if job:
                # Immediately mark as being processed
                cursor.execute("""
                    INSERT INTO job_scrp_job_details (
                        reference_number, scraped_at, scraping_success
                    ) VALUES (%s, %s, false)
                    ON CONFLICT (reference_number) DO NOTHING
                """, (job['refnr'], datetime.now()))
                
                conn.commit()
                
            cursor.close()
            conn.close()
            return job
            
        except Exception as e:
            self.logger.error(f"Database error getting next job: {e}")
            if conn:
                conn.rollback()
                conn.close()
            return None
            
    def save_results_to_db(self, job: Dict[str, Any], email_data: Dict[str, Any], success: bool):
        """Save scraping results to database"""
        conn = None
        try:
            conn = psycopg2.connect(
                host=DB_CONFIG['host'],
                port=DB_CONFIG['port'],
                database=DB_CONFIG['database'],
                user=DB_CONFIG['user'],
                password=DB_CONFIG['password']
            )
            cursor = conn.cursor()
            
            # Update job_details
            cursor.execute("""
                UPDATE job_scrp_job_details 
                SET scraping_success = %s,
                    has_emails = %s,
                    contact_emails = %s,
                    best_email = %s,
                    company_domain = %s,
                    email_count = %s,
                    email_source = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE reference_number = %s
            """, (
                success,
                email_data.get('has_emails', False),
                ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                email_data.get('primary_email'),
                email_data.get('primary_domain'),
                email_data.get('email_count', 0),
                'detail_page' if email_data.get('has_emails') else None,
                job['refnr']
            ))
            
            # Update employer if emails found
            if email_data.get('has_emails') or success:
                cursor.execute("""
                    INSERT INTO job_scrp_employers (name, normalized_name)
                    VALUES (%s, LOWER(%s))
                    ON CONFLICT (name) DO NOTHING
                """, (job['arbeitgeber'], job['arbeitgeber']))
                
                cursor.execute("""
                    UPDATE job_scrp_employers 
                    SET email_extraction_attempted = true,
                        email_extraction_date = %s,
                        contact_emails = %s,
                        website = %s
                    WHERE name = %s
                """, (
                    datetime.now(),
                    ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                    email_data.get('primary_domain'),
                    job['arbeitgeber']
                ))
                
            conn.commit()
            cursor.close()
            conn.close()
            
        except Exception as e:
            self.logger.error(f"Database error saving results: {e}")
            if conn:
                conn.rollback()
                conn.close()
                
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
            
    async def run_worker(self):
        """Main worker loop"""
        
        # Create playwright instance
        playwright = await async_playwright().start()
        
        try:
            # Launch browser with specific window position
            browser = await playwright.chromium.launch(
                headless=False,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    f'--window-position={self.window_positions[self.worker_id]["x"]},{self.window_positions[self.worker_id]["y"]}',
                    '--window-size=960,540'
                ]
            )
            
            # Create context
            context_options = {
                'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
                'locale': 'de-DE',
                'viewport': {'width': 960, 'height': 540}
            }
            
            # Load saved state if exists
            if self.state_file.exists():
                context_options['storage_state'] = str(self.state_file)
                
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            page.set_default_timeout(BROWSER_TIMEOUT)
            
            # Add worker indicator
            worker_color = self.worker_colors[self.worker_id]
            await page.add_init_script(f'''
                window.workerInfo = {{
                    id: {self.worker_id},
                    color: '{worker_color}',
                    processed: 0,
                    withEmails: 0
                }};
                
                window.updateWorkerDisplay = function(employer, status, emails) {{
                    let statusDiv = document.getElementById('worker-status');
                    if (!statusDiv) {{
                        statusDiv = document.createElement('div');
                        statusDiv.id = 'worker-status';
                        statusDiv.style.position = 'fixed';
                        statusDiv.style.top = '0';
                        statusDiv.style.left = '0';
                        statusDiv.style.right = '0';
                        statusDiv.style.padding = '15px';
                        statusDiv.style.background = window.workerInfo.color;
                        statusDiv.style.color = 'white';
                        statusDiv.style.fontSize = '14px';
                        statusDiv.style.fontWeight = 'bold';
                        statusDiv.style.zIndex = '99999';
                        statusDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
                        document.body.appendChild(statusDiv);
                    }}
                    
                    window.workerInfo.processed++;
                    if (emails && emails.length > 0) window.workerInfo.withEmails++;
                    
                    statusDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>WORKER ${{window.workerInfo.id}} | ${{employer.substring(0, 40)}}...</div>
                            <div>${{status}} ${{emails ? '📧 ' + emails.join(', ') : '📭 No emails'}}</div>
                        </div>
                        <div style="margin-top: 5px; font-size: 12px;">
                            Processed: ${{window.workerInfo.processed}} | With Emails: ${{window.workerInfo.withEmails}} | Success Rate: ${{(window.workerInfo.withEmails / window.workerInfo.processed * 100).toFixed(1)}}%
                        </div>
                    `;
                }};
            ''')
            
            self.logger.info(f"🚀 Worker {self.worker_id} started in {worker_color} window")
            
            # Main processing loop
            while True:
                # Get next job from database
                job = self.get_next_job_from_db()
                
                if not job:
                    self.logger.info("No more jobs to process")
                    await asyncio.sleep(10)  # Wait before checking again
                    continue
                    
                self.logger.info(f"Processing: {job['arbeitgeber'][:50]}... - {job['titel'][:30]}...")
                self.processed_count += 1
                
                try:
                    # Navigate to job
                    url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
                    response = await page.goto(url, wait_until='domcontentloaded')
                    
                    if response and response.status == 404:
                        self.logger.warning("💀 404 error")
                        self.save_results_to_db(job, {}, False)
                        continue
                        
                    await page.wait_for_timeout(2000)
                    
                    # Handle cookies on first visit
                    cookie_button = await page.query_selector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]')
                    if cookie_button:
                        await cookie_button.click()
                        await page.wait_for_timeout(2000)
                        await context.storage_state(path=str(self.state_file))
                    
                    # Handle CAPTCHA
                    captcha_success = await self.solve_captcha_on_page(page)
                    
                    if captcha_success:
                        self.success_count += 1
                        
                        # Extract emails
                        page_content = await page.content()
                        email_data = self.email_extractor.extract_from_page_content(page_content, job['arbeitgeber'])
                        
                        if email_data['has_emails']:
                            self.email_count += 1
                            self.logger.info(f"📧 Found emails: {email_data['emails']}")
                        else:
                            self.logger.info("📭 No emails found")
                            
                        # Update display
                        await page.evaluate(f'''
                            updateWorkerDisplay(
                                "{job['arbeitgeber'][:50]}",
                                "✅ Success",
                                {email_data.get('emails', [])}
                            );
                        ''')
                        
                        # Save to database
                        self.save_results_to_db(job, email_data, True)
                    else:
                        self.logger.warning("❌ CAPTCHA failed")
                        self.save_results_to_db(job, {}, False)
                        
                    # Short delay between jobs
                    await asyncio.sleep(5)
                    
                except Exception as e:
                    self.logger.error(f"Error processing job: {e}")
                    self.save_results_to_db(job, {}, False)
                    
        finally:
            await browser.close()
            await playwright.stop()


async def main():
    """Run 4 parallel workers in split screen"""
    
    print("\n" + "="*60)
    print("🚀 Starting 4-Window Parallel Scraper")
    print("🖥️  Opening 4 browser windows in quadrants")
    print("📊 Database-driven coordination - no overlaps")
    print("🔄 Continuous operation - press Ctrl+C to stop")
    print("="*60 + "\n")
    
    # Create 4 worker tasks
    workers = []
    for worker_id in range(4):
        worker = DatabaseWorkerScraper(worker_id)
        task = worker.run_worker()
        workers.append(task)
        
    print("⏳ Launching 4 workers...\n")
    
    try:
        # Run all workers concurrently
        await asyncio.gather(*workers)
    except KeyboardInterrupt:
        print("\n\n👋 Stopping all workers...")
        print("="*60)
        print("📊 Session Summary:")
        # Workers would need to expose stats for a proper summary
        print("✅ Scraping session completed")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n✅ Gracefully stopped!")