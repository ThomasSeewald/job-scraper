import asyncio
import logging
import base64
import random
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
import aiohttp
import psycopg2
from psycopg2.extras import RealDictCursor

from config import (
    DB_CONFIG, CAPTCHA_API_KEY, BROWSER_HEADLESS, 
    BROWSER_TIMEOUT, COOKIE_BASE_DIR
)
from email_extractor import EmailExtractor

logger = logging.getLogger(__name__)


class BaseScraper:
    """Base class for all Arbeitsagentur scrapers with unified cookie and CAPTCHA handling"""
    
    def __init__(self, scraper_name: str, process_id: Optional[int] = None):
        self.scraper_name = scraper_name
        self.process_id = process_id or asyncio.get_event_loop().time()
        
        # Cookie handling
        self.cookie_dir = COOKIE_BASE_DIR / f'{scraper_name}-{self.process_id}'
        self.cookie_dir.mkdir(exist_ok=True)
        self.cookie_marker = self.cookie_dir / 'cookies_accepted'
        self.state_file = self.cookie_dir / 'state.json'
        
        # Browser components
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        
        # CAPTCHA handling
        self.captcha_api_key = CAPTCHA_API_KEY
        
        # Email extraction
        self.email_extractor = EmailExtractor()
        
        # Database
        self.db_conn = None
        self.db_cursor = None
        
    async def __aenter__(self):
        """Async context manager entry"""
        await self.initialize()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.cleanup()
        
    async def initialize(self):
        """Initialize browser, database, and ensure cookies are accepted"""
        logger.info(f"🚀 Initializing {self.scraper_name} scraper...")
        
        # Initialize database
        self._init_database()
        
        # Initialize browser
        await self._init_browser()
        
        # Ensure cookies are accepted
        await self._ensure_cookies_accepted()
        
        logger.info(f"✅ {self.scraper_name} scraper initialized successfully")
        
    def _init_database(self):
        """Initialize database connection"""
        self.db_conn = psycopg2.connect(
            host=DB_CONFIG['host'],
            port=DB_CONFIG['port'],
            database=DB_CONFIG['database'],
            user=DB_CONFIG['user'],
            password=DB_CONFIG['password']
        )
        self.db_cursor = self.db_conn.cursor(cursor_factory=RealDictCursor)
        
    async def _init_browser(self):
        """Initialize Playwright browser with consistent settings"""
        self.playwright = await async_playwright().start()
        
        # Launch browser
        self.browser = await self.playwright.chromium.launch(
            headless=BROWSER_HEADLESS,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        )
        
        # Create context with persistent storage
        context_options = {
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'locale': 'de-DE',
            'viewport': {'width': 1920, 'height': 1080},
            'extra_http_headers': {
                'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'DNT': '1'
            }
        }
        
        # Load existing state if available
        if self.state_file.exists():
            context_options['storage_state'] = str(self.state_file)
            
        self.context = await self.browser.new_context(**context_options)
        self.page = await self.context.new_page()
        
        # Set default timeout
        self.page.set_default_timeout(BROWSER_TIMEOUT)
        
    async def _ensure_cookies_accepted(self):
        """Ensure cookies are accepted using consistent approach"""
        if not self.cookie_marker.exists():
            logger.info("🍪 First run - need to accept cookies")
            logger.info("📝 Note: Cookie modal will appear on first job page visit")
            # Don't navigate to main page - let the cookie modal appear on the first job detail page
        else:
            logger.info("✅ Using existing cookie preferences")
            
    async def _accept_cookies(self) -> bool:
        """Accept cookies with multiple fallback strategies"""
        try:
            # Strategy 1: Exact selector
            button = await self.page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=10000,
                state='visible'
            )
            if button:
                await button.click()
                await self.page.wait_for_timeout(3000)
                
                # Check if modal is really gone
                modal_gone = await self.page.evaluate('''
                    () => {
                        const modal = document.querySelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                        return !modal || modal.offsetParent === null;
                    }
                ''')
                
                if modal_gone:
                    logger.info("✅ Cookie modal successfully removed")
                    # Take screenshot after cookie acceptance
                    await self.page.screenshot(path='after_cookie_acceptance.png')
                    return True
                else:
                    logger.warning("⚠️ Cookie modal still visible after click!")
                    # Take screenshot to debug
                    await self.page.screenshot(path='cookie_still_visible.png')
                    return False
        except:
            pass
            
        try:
            # Strategy 2: Text-based
            button = await self.page.get_by_role("button", name="Alle Cookies akzeptieren")
            if await button.is_visible():
                await button.click()
                await self.page.wait_for_timeout(3000)
                return True
        except:
            pass
            
        try:
            # Strategy 3: XPath
            button = await self.page.locator('//button[contains(text(), "Alle Cookies akzeptieren")]').first
            if await button.is_visible():
                await button.click()
                await self.page.wait_for_timeout(3000)
                return True
        except:
            pass
            
        return False
        
    async def solve_captcha(self, page: Optional[Page] = None) -> Optional[str]:
        """Solve CAPTCHA using 2captcha service"""
        if not page:
            page = self.page
            
        try:
            # Wait for CAPTCHA to fully load
            logger.info("⏳ Checking for CAPTCHA...")
            
            # Try to wait for CAPTCHA image to appear
            try:
                await page.wait_for_selector('img[src*="captcha"]', timeout=1000)
                logger.info("✅ CAPTCHA element found")
            except:
                # No CAPTCHA found - this is good!
                return None
            
            # Double check CAPTCHA exists - look for the actual CAPTCHA URL pattern
            captcha_img = await page.query_selector('img[src*="/idaas/id-aas-service/ct/v1/captcha/"], img[src*="captcha"]')
            if not captcha_img:
                return None
                
            logger.info("🧩 CAPTCHA detected, solving...")
            
            # Wait extra time for CAPTCHA to fully render
            await page.wait_for_timeout(3000)
            
            # Scroll CAPTCHA into view
            await page.evaluate('''
                const captchaImg = document.querySelector('img[src*="captcha"]');
                if (captchaImg) {
                    captchaImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            ''')
            await page.wait_for_timeout(2000)  # Wait for scroll
            
            # Get CAPTCHA image
            captcha_src = await captcha_img.get_attribute('src')
            
            # Check if image is actually loaded with retry logic
            max_retries = 3
            retry_delay = 5000  # 5 seconds
            
            for retry in range(max_retries):
                image_loaded = await page.evaluate('''
                    () => {
                        const img = document.querySelector('img[src*="captcha"]');
                        return img && img.complete && img.naturalHeight !== 0;
                    }
                ''')
                
                if image_loaded:
                    logger.info("✅ CAPTCHA image loaded successfully")
                    break
                    
                logger.warning(f"⚠️ CAPTCHA image not loaded, retry {retry + 1}/{max_retries}...")
                await page.wait_for_timeout(retry_delay)
                
                # On last retry, try to refresh the CAPTCHA
                if retry == max_retries - 1 and not image_loaded:
                    logger.info("🔄 Attempting to refresh CAPTCHA...")
                    # Click on the image to potentially refresh it
                    try:
                        await captcha_img.click()
                        await page.wait_for_timeout(2000)
                    except:
                        pass
            
            if not image_loaded:
                logger.error("❌ CAPTCHA image failed to load after all retries")
                # Take screenshot for debugging
                await page.screenshot(path='captcha_blocked.png')
                return None
            
            if captcha_src.startswith('data:'):
                # Base64 encoded image
                image_data = captcha_src.split(',')[1]
            else:
                # Download image
                try:
                    img_response = await page.evaluate(f'''
                        fetch("{captcha_src}")
                            .then(r => {{
                                if (!r.ok) throw new Error('Failed to fetch: ' + r.status);
                                return r.blob();
                            }})
                            .then(blob => new Promise((resolve) => {{
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            }}))
                    ''')
                    image_data = img_response
                except Exception as e:
                    logger.error(f"Failed to download CAPTCHA image: {e}")
                    return None
                
            # Send to 2captcha
            async with aiohttp.ClientSession() as session:
                # Submit CAPTCHA
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
                        return None
                        
                    captcha_id = result['request']
                    
                # Wait and get result
                await asyncio.sleep(20)  # Wait 20 seconds
                
                for attempt in range(10):  # Try 10 times
                    async with session.get(f'http://2captcha.com/res.php?key={self.captcha_api_key}&action=get&id={captcha_id}&json=1') as resp:
                        result = await resp.json()
                        
                        if result.get('status') == 1:
                            solution = result['request']
                            logger.info(f"✅ CAPTCHA solved: {solution}")
                            
                            # Scroll to input field
                            await page.evaluate('''
                                const captchaInput = document.querySelector('input[id="kontaktdaten-captcha-input"], input[formcontrolname="captchaLoesungControl"]');
                                if (captchaInput) {
                                    captchaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            ''')
                            await page.wait_for_timeout(500)
                            
                            # Enter solution
                            captcha_input = await page.query_selector('input[id="kontaktdaten-captcha-input"], input[formcontrolname="captchaLoesungControl"]')
                            if captcha_input:
                                await captcha_input.fill(solution)
                                logger.info("📝 Entered CAPTCHA solution")
                                
                                # Trigger input and change events to enable submit button
                                await page.evaluate('''
                                    const input = document.querySelector('#kontaktdaten-captcha-input');
                                    if (input) {
                                        input.dispatchEvent(new Event('input', { bubbles: true }));
                                        input.dispatchEvent(new Event('change', { bubbles: true }));
                                        input.dispatchEvent(new Event('blur', { bubbles: true }));
                                    }
                                ''')
                                
                                # Wait only 100ms after input
                                await page.wait_for_timeout(100)
                                logger.info("⏳ Waited 100ms after input")
                                
                                # Submit form - use only the specific button ID
                                submit_button = await page.query_selector('button[id="kontaktdaten-captcha-absenden-button"]')
                                if submit_button:
                                    logger.info("🖱️ Clicking submit button...")
                                    await submit_button.click()
                                    
                                    # Wait for submit to process
                                    await page.wait_for_timeout(2000)
                                    
                                    # Wait for page to load after CAPTCHA
                                    logger.info("⏳ Waiting for page to load after CAPTCHA...")
                                    await page.wait_for_timeout(5000)  # Wait 5 seconds for content
                                    
                            return solution
                            
                        elif result.get('request') != 'CAPCHA_NOT_READY':
                            logger.error(f"CAPTCHA solve failed: {result}")
                            return None
                            
                    await asyncio.sleep(5)
                    
        except Exception as e:
            logger.error(f"CAPTCHA solving error: {e}")
            return None
            
    async def check_for_404(self, page: Optional[Page] = None) -> bool:
        """Check if page is 404 to save CAPTCHA credits"""
        if not page:
            page = self.page
            
        try:
            # Take screenshot for debugging
            await page.screenshot(path='404_check_debug.png')
            
            # Check for 404 indicators - be specific to avoid false positives
            not_found_indicators = [
                'Die gewünschte Seite konnte nicht gefunden werden',
                'Seite nicht gefunden',
                'Fehler 404',
                'Error 404',
                '404 - Seite',
                'nicht mehr verfügbar',
                'bereits vergeben'
            ]
            
            page_content = await page.content()
            
            # Log the page title for debugging
            title = await page.title()
            logger.info(f"Page title: {title}")
            
            # Don't check for 404 if we just accepted cookies
            # The page needs time to fully load
            
            for indicator in not_found_indicators:
                if indicator in page_content:
                    logger.info(f"💀 404 detected - found indicator: '{indicator}'")
                    return True
                    
            return False
            
        except Exception as e:
            logger.error(f"Error checking for 404: {e}")
            return False
            
    async def _simulate_human_behavior(self):
        """Simulate human-like mouse movements and scrolling"""
        try:
            # Random mouse movements
            for _ in range(random.randint(2, 4)):
                x = random.randint(100, 800)
                y = random.randint(100, 600)
                await self.page.mouse.move(x, y)
                await asyncio.sleep(random.uniform(0.1, 0.3))
            
            # Random scroll
            await self.page.evaluate(f'window.scrollBy(0, {random.randint(50, 200)})')
            await asyncio.sleep(random.uniform(0.5, 1.0))
        except:
            pass  # Don't fail if simulation fails
    
    async def navigate_to_job(self, job_url: str) -> bool:
        """Navigate to job URL with 404 checking, cookie handling, and CAPTCHA handling"""
        try:
            # Navigate to URL
            response = await self.page.goto(job_url, wait_until='domcontentloaded')
            
            # Check response status
            if response and response.status == 404:
                logger.info("💀 404 response - job no longer exists")
                return False
                
            # Small wait for initial page load
            await self.page.wait_for_timeout(500)
            
            # Check if cookie modal appeared (only on first run)
            if not self.cookie_marker.exists():
                cookie_accepted = await self._accept_cookies()
                
                # Save state and create marker regardless of whether cookies were accepted
                # This prevents repeated attempts when no cookie banner exists
                await self.context.storage_state(path=str(self.state_file))
                self.cookie_marker.write_text('handled')
                
                if cookie_accepted:
                    logger.info("✅ Cookies accepted on job page")
                    
                    # Immediately scroll to contact section
                    logger.info("📜 Scrolling to contact section...")
                    await self.page.evaluate('''
                        const element = document.getElementById('jobdetails-kontaktdaten-container');
                        if (element) {
                            element.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                    ''')
                else:
                    logger.info("🍪 No cookie banner found - proceeding without cookie acceptance")
            
            # Check for 404 content
            if await self.check_for_404():
                return False
            
            # Faster content loading check
            await self.page.wait_for_timeout(1000)  # Quick wait for content
            
            # Check for CAPTCHA
            logger.info("🔍 Checking for CAPTCHA...")
            
            # Check if there's a Sicherheitsabfrage (Security check) section
            security_check = await self.page.query_selector('h3:has-text("Sicherheitsabfrage")')
            if security_check:
                logger.info("🔒 Security check section found - CAPTCHA present")
                # Wait for CAPTCHA image to load
                await self.page.wait_for_timeout(3000)
            
            # Handle CAPTCHA if present
            captcha_solved = await self.solve_captcha()
            if captcha_solved:
                # Extra wait after CAPTCHA to ensure content loads
                logger.info("⏳ Waiting for content after CAPTCHA...")
                await self.page.wait_for_timeout(3000)
                
                # IMPORTANT: Save updated cookies after CAPTCHA solving
                logger.info("🔄 Saving updated cookies after CAPTCHA...")
                await self.context.storage_state(path=str(self.state_file))
            
            # Final wait for content
            await self.page.wait_for_timeout(2000)
            
            return True
            
        except Exception as e:
            logger.error(f"Navigation error: {e}")
            return False
            
    async def extract_emails_from_page(self, company_name: str = '') -> Dict[str, Any]:
        """Extract emails from current page"""
        try:
            # Get page content
            page_content = await self.page.content()
            
            # Extract emails
            result = self.email_extractor.extract_from_page_content(page_content, company_name)
            
            return result
            
        except Exception as e:
            logger.error(f"Email extraction error: {e}")
            return {
                'emails': [],
                'domains': [],
                'email_count': 0,
                'has_emails': False,
                'primary_email': None,
                'primary_domain': None
            }
            
    async def cleanup(self):
        """Clean up resources"""
        logger.info(f"🧹 Cleaning up {self.scraper_name} scraper...")
        
        # Save browser state
        if self.context:
            try:
                await self.context.storage_state(path=str(self.state_file))
            except:
                pass
                
        # Close browser
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
            
        # Close database
        if self.db_cursor:
            self.db_cursor.close()
        if self.db_conn:
            self.db_conn.close()
            
        logger.info(f"✅ {self.scraper_name} cleanup complete")


async def test_base_scraper():
    """Test the base scraper functionality"""
    logging.basicConfig(level=logging.INFO)
    
    async with BaseScraper('test') as scraper:
        # Test navigation
        success = await scraper.navigate_to_job('https://www.arbeitsagentur.de/jobsuche/')
        logger.info(f"Navigation success: {success}")
        
        # Keep open for inspection
        await asyncio.sleep(5)


if __name__ == '__main__':
    asyncio.run(test_base_scraper())