import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
import logging

logger = logging.getLogger(__name__)

class CookieHandler:
    """Handles cookie acceptance and persistence for Arbeitsagentur"""
    
    def __init__(self, process_name: str, process_id: int):
        self.process_name = process_name
        self.process_id = process_id
        self.cookie_dir = Path.home() / f'.job-scraper-cookies-python-{process_name}-{process_id}'
        self.cookie_dir.mkdir(exist_ok=True)
        self.cookie_marker = self.cookie_dir / 'cookies_accepted'
        
    async def create_browser_context(self, playwright) -> tuple[Browser, BrowserContext]:
        """Create browser and context with persistent storage"""
        browser = await playwright.chromium.launch(
            headless=False,  # Always visible for cookie debugging
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        
        # Create context with persistent storage
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='de-DE',
            viewport={'width': 1920, 'height': 1080},
            storage_state=str(self.cookie_dir / 'state.json') if (self.cookie_dir / 'state.json').exists() else None
        )
        
        return browser, context
        
    async def accept_cookies(self, page: Page) -> bool:
        """Accept cookies on Arbeitsagentur site"""
        try:
            logger.info("Checking for cookie modal...")
            
            # Wait for cookie button with multiple strategies
            cookie_button = None
            
            # Strategy 1: Wait for the specific test-id
            try:
                cookie_button = await page.wait_for_selector(
                    'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                    timeout=10000,
                    state='visible'
                )
                logger.info("Found cookie button via data-testid")
            except:
                pass
                
            # Strategy 2: Look for button by text
            if not cookie_button:
                try:
                    cookie_button = await page.get_by_role("button", name="Alle Cookies akzeptieren").first
                    if await cookie_button.is_visible():
                        logger.info("Found cookie button via text")
                    else:
                        cookie_button = None
                except:
                    pass
                    
            # Strategy 3: XPath with text content
            if not cookie_button:
                try:
                    cookie_button = await page.locator('//button[contains(text(), "Alle Cookies akzeptieren")]').first
                    if await cookie_button.is_visible():
                        logger.info("Found cookie button via XPath")
                    else:
                        cookie_button = None
                except:
                    pass
            
            if cookie_button:
                logger.info("Cookie modal found, accepting cookies...")
                await cookie_button.click()
                
                # Wait for modal to disappear
                await page.wait_for_timeout(3000)
                
                # Save the state
                await page.context.storage_state(path=str(self.cookie_dir / 'state.json'))
                
                # Mark cookies as accepted
                self.cookie_marker.write_text('true')
                
                logger.info("✅ Cookies accepted and saved successfully")
                return True
            else:
                logger.info("No cookie modal found")
                return False
                
        except Exception as e:
            logger.error(f"Cookie handling error: {e}")
            return False
            
    async def ensure_cookies_accepted(self, page: Page) -> None:
        """Ensure cookies are accepted, navigate to main page if needed"""
        if not self.cookie_marker.exists():
            logger.info("First run - navigating to main site to handle cookies...")
            await page.goto('https://www.arbeitsagentur.de', wait_until='domcontentloaded')
            await page.wait_for_timeout(5000)  # Give modal time to appear
            
            success = await self.accept_cookies(page)
            if not success:
                logger.warning("Could not accept cookies on first attempt")
        else:
            logger.info("✅ Using existing cookie preferences")


async def test_cookie_handling():
    """Test the cookie handling functionality"""
    import os
    logging.basicConfig(level=logging.INFO)
    
    handler = CookieHandler('test', os.getpid())
    
    async with async_playwright() as playwright:
        browser, context = await handler.create_browser_context(playwright)
        page = await context.new_page()
        
        try:
            # Test cookie acceptance
            await handler.ensure_cookies_accepted(page)
            
            # Navigate to a job page to verify cookies work
            logger.info("Testing navigation to job page...")
            await page.goto('https://www.arbeitsagentur.de/jobsuche/')
            await page.wait_for_timeout(3000)
            
            # Check if cookie modal appears again
            cookie_modal = await page.query_selector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]')
            if cookie_modal and await cookie_modal.is_visible():
                logger.warning("❌ Cookie modal appeared again - cookies not persisting!")
            else:
                logger.info("✅ No cookie modal - cookies are persisting correctly!")
                
            logger.info("Test completed. Browser will close in 5 seconds...")
            await page.wait_for_timeout(5000)
            
        finally:
            await context.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(test_cookie_handling())