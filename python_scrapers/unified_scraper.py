#!/usr/bin/env python3
"""Unified scraper with atomic employer claiming for perfect parallel coordination"""

import asyncio
import logging
import sys
from datetime import datetime
from typing import Dict, Any, Optional, Tuple
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
logger = logging.getLogger(__name__)


class UnifiedScraper:
    """Unified scraper with atomic database operations for parallel execution"""
    
    def __init__(self, worker_id: int = 0, mode: str = 'batch', batch_size: int = 50, 
                 delay_seconds: int = 10, headless: bool = False):
        self.worker_id = worker_id
        self.mode = mode  # 'batch' or 'continuous'
        self.batch_size = batch_size
        self.delay_seconds = delay_seconds
        self.headless = headless
        
        # Setup directories
        self.cookie_dir = COOKIE_BASE_DIR / f'unified-worker-{worker_id}'
        self.cookie_dir.mkdir(exist_ok=True)
        self.state_file = self.cookie_dir / 'state.json'
        
        # Tools
        self.email_extractor = EmailExtractor()
        self.captcha_api_key = CAPTCHA_API_KEY
        
        # Stats
        self.processed_count = 0
        self.success_count = 0
        self.email_count = 0
        
        # Browser components
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        
    def get_db_connection(self):
        """Get a new database connection"""
        return psycopg2.connect(
            host=DB_CONFIG['host'],
            port=DB_CONFIG['port'],
            database=DB_CONFIG['database'],
            user=DB_CONFIG['user'],
            password=DB_CONFIG['password']
        )
        
    def claim_next_employer(self) -> Optional[Tuple[str, str, str]]:
        """Atomically claim next employer and return (employer_name, refnr, job_title)"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Faster approach: Get job directly with employer claim
            cursor.execute("""
                WITH available_jobs AS (
                    SELECT j.refnr, j.titel, j.arbeitgeber, e.id as employer_id
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    INNER JOIN job_scrp_employers e ON e.name = j.arbeitgeber
                    WHERE e.email_extraction_attempted = false
                      AND j.externeurl IS NULL
                      AND j.refnr IS NOT NULL
                      AND j.is_active = true
                    ORDER BY j.aktuelleveroeffentlichungsdatum DESC
                    LIMIT 100
                )
                UPDATE job_scrp_employers 
                SET email_extraction_date = NOW(),
                    email_extraction_attempted = true
                FROM available_jobs
                WHERE job_scrp_employers.id = available_jobs.employer_id
                  AND job_scrp_employers.id = (
                    SELECT employer_id FROM available_jobs 
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                  )
                RETURNING job_scrp_employers.name, available_jobs.refnr, available_jobs.titel;
            """)
            
            result = cursor.fetchone()
            
            if result:
                # We now get all data in one query: name, refnr, titel
                conn.commit()
                cursor.close()
                conn.close()
                return (result[0], result[1], result[2])  # employer_name, refnr, titel
                    
            cursor.close()
            conn.close()
            return None
            
        except Exception as e:
            logger.error(f"Error claiming employer: {e}")
            if conn:
                conn.rollback()
                conn.close()
            return None
            
    def save_results(self, employer_name: str, refnr: str, email_data: Dict[str, Any], success: bool):
        """Save scraping results to database"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
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
            cursor.close()
            conn.close()
            
        except Exception as e:
            logger.error(f"Error saving results: {e}")
            if conn:
                conn.rollback()
                conn.close()
                
    async def initialize_browser(self):
        """Initialize Playwright browser"""
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        )
        
        # Create context with persistent storage
        context_options = {
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'locale': 'de-DE',
            'viewport': {'width': 1920, 'height': 1080}
        }
        
        if self.state_file.exists():
            context_options['storage_state'] = str(self.state_file)
            
        self.context = await self.browser.new_context(**context_options)
        self.page = await self.context.new_page()
        self.page.set_default_timeout(BROWSER_TIMEOUT)
        
        logger.info(f"🚀 Worker {self.worker_id} browser initialized")
        
    async def solve_captcha(self) -> bool:
        """Solve CAPTCHA if present"""
        try:
            # Check for CAPTCHA
            captcha_img = await self.page.query_selector('img[src*="/idaas/id-aas-service/ct/v1/captcha/"], img[src*="captcha"]')
            if not captcha_img:
                return True
                
            logger.info("🧩 CAPTCHA detected, solving...")
            
            # Get CAPTCHA image
            captcha_src = await captcha_img.get_attribute('src')
            
            # Extract image data
            if captcha_src.startswith('data:'):
                image_data = captcha_src.split(',')[1]
            else:
                # Download image
                img_response = await self.page.evaluate(f'''
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
                    if result.get('status') != 1:
                        logger.error(f"CAPTCHA submit failed: {result}")
                        return False
                        
                    captcha_id = result['request']
                    
                # Wait and get result
                await asyncio.sleep(20)
                
                for attempt in range(10):
                    async with session.get(f'http://2captcha.com/res.php?key={self.captcha_api_key}&action=get&id={captcha_id}&json=1') as resp:
                        result = await resp.json()
                        
                        if result.get('status') == 1:
                            solution = result['request']
                            logger.info(f"✅ CAPTCHA solved: {solution}")
                            
                            # Enter solution
                            captcha_input = await self.page.query_selector('#kontaktdaten-captcha-input')
                            if captcha_input:
                                await captcha_input.fill(solution)
                                await self.page.wait_for_timeout(100)
                                
                                # Submit
                                submit_button = await self.page.query_selector('#kontaktdaten-captcha-absenden-button')
                                if submit_button:
                                    await submit_button.click()
                                    await self.page.wait_for_timeout(3000)  # Reduced from 5000ms
                                    
                                    # Save updated cookies
                                    await self.context.storage_state(path=str(self.state_file))
                                    
                                    # Scroll down again after CAPTCHA to see contact data
                                    logger.info("📜 Scrolling to contact section after CAPTCHA...")
                                    await self.page.evaluate('''
                                        const element = document.getElementById('jobdetails-kontaktdaten-container');
                                        if (element) {
                                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        } else {
                                            window.scrollTo({
                                                top: document.body.scrollHeight / 2,
                                                behavior: 'smooth'
                                            });
                                        }
                                    ''')
                                    await self.page.wait_for_timeout(1500)
                                    
                            return True
                            
                        elif result.get('request') != 'CAPCHA_NOT_READY':
                            logger.error(f"CAPTCHA solve failed: {result}")
                            return False
                            
                    await asyncio.sleep(5)
                    
        except Exception as e:
            logger.error(f"CAPTCHA error: {e}")
            return False
            
    async def process_job(self, employer_name: str, refnr: str, job_title: str) -> Dict[str, Any]:
        """Process a single job"""
        url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}"
        
        try:
            # Navigate to job
            response = await self.page.goto(url, wait_until='domcontentloaded')
            
            if response and response.status == 404:
                logger.warning(f"💀 404 error for {employer_name}")
                return {'success': False, 'error': '404'}
                
            # Only wait if we might need to handle cookies
            if not self.state_file.exists():
                await self.page.wait_for_timeout(500)
                
                # Handle cookies on first visit
                try:
                    cookie_button = await self.page.query_selector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]')
                    if cookie_button and await cookie_button.is_visible():
                        await cookie_button.click()
                        await self.page.wait_for_timeout(2000)
                        await self.context.storage_state(path=str(self.state_file))
                        logger.info("🍪 Cookies accepted")
                except Exception as e:
                    logger.warning(f"Cookie handling issue (continuing anyway): {e}")
            
            # Check for 404 content
            page_content = await self.page.content()
            if 'nicht mehr verfügbar' in page_content or 'nicht gefunden' in page_content:
                logger.warning(f"💀 Job no longer available for {employer_name}")
                return {'success': False, 'error': '404'}
            
            # Always scroll down to contact section to see the data
            logger.info("📜 Scrolling to contact section...")
            await self.page.evaluate('''
                const element = document.getElementById('jobdetails-kontaktdaten-container');
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    // Fallback: scroll to bottom half of page
                    window.scrollTo({
                        top: document.body.scrollHeight / 2,
                        behavior: 'smooth'
                    });
                }
            ''')
            # No wait needed - scroll is instant with behavior: 'smooth'
            
            # Handle CAPTCHA
            if not await self.solve_captcha():
                return {'success': False, 'error': 'CAPTCHA failed'}
            
            # Check for external application URL
            external_url = None
            external_domain = None
            try:
                external_link = await self.page.query_selector('a#detail-bewerbung-url[href*="jobexport.de"]')
                if external_link:
                    external_url = await external_link.get_attribute('href')
                    logger.info(f"🔗 Found external URL: {external_url}")
                    
                    # Follow redirect to get actual domain
                    if external_url:
                        async with aiohttp.ClientSession() as session:
                            try:
                                async with session.get(external_url, allow_redirects=True, timeout=5) as resp:
                                    final_url = str(resp.url)
                                    from urllib.parse import urlparse
                                    parsed = urlparse(final_url)
                                    external_domain = parsed.netloc
                                    logger.info(f"🌐 External domain: {external_domain}")
                            except Exception as e:
                                logger.warning(f"Failed to follow redirect: {e}")
                                external_domain = None
            except Exception as e:
                logger.warning(f"Failed to check external URL: {e}")
                external_domain = None
            
            # Extract emails
            page_content = await self.page.content()
            email_data = self.email_extractor.extract_from_page_content(page_content, employer_name)
            
            # Add external domain if found
            if external_domain and not email_data.get('primary_domain'):
                email_data['primary_domain'] = external_domain
                email_data['external_url'] = external_url
            
            return {
                'success': True,
                **email_data
            }
            
        except Exception as e:
            logger.error(f"Error processing job: {e}")
            return {'success': False, 'error': str(e)}
            
    async def run(self):
        """Main scraping loop"""
        await self.initialize_browser()
        
        logger.info(f"🚀 Worker {self.worker_id} starting in {self.mode} mode")
        
        while True:
            # Claim next employer atomically
            claim = self.claim_next_employer()
            
            if not claim:
                if self.mode == 'batch':
                    logger.info("No more employers to process in batch")
                    break
                else:  # continuous mode
                    logger.info("No employers available, waiting...")
                    await asyncio.sleep(30)
                    continue
                    
            employer_name, refnr, job_title = claim
            self.processed_count += 1
            
            logger.info(f"\n{'='*60}")
            logger.info(f"[{self.processed_count}] Processing: {employer_name[:50] if employer_name else 'Unknown'}...")
            logger.info(f"📋 Job: {job_title[:50] if job_title else 'No title'}...")
            
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
            if self.mode == 'batch' and self.processed_count >= self.batch_size:
                logger.info(f"Batch limit reached ({self.batch_size})")
                break
                
            # Delay between requests (only if configured)
            if self.delay_seconds > 0:
                await asyncio.sleep(self.delay_seconds)
            
        # Summary
        logger.info(f"\n{'='*60}")
        logger.info(f"🎯 Worker {self.worker_id} Summary:")
        logger.info(f"   Processed: {self.processed_count}")
        logger.info(f"   Successful: {self.success_count}")
        logger.info(f"   With emails: {self.email_count}")
        if self.processed_count > 0:
            logger.info(f"   Success rate: {self.email_count/self.processed_count*100:.1f}%")
            
        if not self.headless:
            logger.info("🌐 Browser staying open. Press Ctrl+C to close...")
            try:
                await asyncio.sleep(86400)
            except KeyboardInterrupt:
                pass
                
    async def cleanup(self):
        """Clean up resources"""
        if self.context:
            await self.context.storage_state(path=str(self.state_file))
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()


async def main():
    """Main entry point"""
    import argparse
    parser = argparse.ArgumentParser(description='Unified scraper with atomic coordination')
    parser.add_argument('--worker-id', type=int, default=0, help='Worker ID (default: 0)')
    parser.add_argument('--mode', choices=['batch', 'continuous'], default='batch', 
                        help='Mode: batch or continuous (default: batch)')
    parser.add_argument('--batch-size', type=int, default=50, 
                        help='Batch size for batch mode (default: 50)')
    parser.add_argument('--delay', type=int, default=10, 
                        help='Delay between requests in seconds (default: 10)')
    parser.add_argument('--headless', action='store_true', 
                        help='Run in headless mode')
    
    args = parser.parse_args()
    
    scraper = UnifiedScraper(
        worker_id=args.worker_id,
        mode=args.mode,
        batch_size=args.batch_size,
        delay_seconds=args.delay,
        headless=args.headless
    )
    
    try:
        await scraper.run()
    finally:
        await scraper.cleanup()


if __name__ == '__main__':
    asyncio.run(main())