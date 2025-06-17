import asyncio
import logging
from playwright.async_api import async_playwright
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_cookie_acceptance():
    """Test cookie acceptance with visual confirmation"""
    
    cookie_dir = Path.home() / '.job-scraper-cookies-python-test'
    cookie_dir.mkdir(exist_ok=True)
    
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=False,  # Always visible for testing
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='de-DE',
            viewport={'width': 1920, 'height': 1080}
        )
        
        page = await context.new_page()
        
        try:
            logger.info("🌐 Navigating to Arbeitsagentur...")
            await page.goto('https://www.arbeitsagentur.de', wait_until='domcontentloaded')
            
            logger.info("⏳ Waiting for page to fully load...")
            await page.wait_for_timeout(5000)
            
            # Take screenshot before
            await page.screenshot(path='before_cookie_click.png')
            logger.info("📸 Screenshot saved: before_cookie_click.png")
            
            # Try to find and click cookie button
            cookie_clicked = False
            
            # Method 1: Wait for selector
            try:
                logger.info("🔍 Looking for cookie button...")
                button = await page.wait_for_selector(
                    'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                    timeout=10000,
                    state='visible'
                )
                
                if button:
                    logger.info("✅ Found cookie button! Clicking...")
                    await button.click()
                    cookie_clicked = True
            except Exception as e:
                logger.error(f"Could not find button with selector: {e}")
            
            if not cookie_clicked:
                # Method 2: Click by text
                try:
                    await page.click('text="Alle Cookies akzeptieren"')
                    cookie_clicked = True
                    logger.info("✅ Clicked cookie button by text")
                except:
                    pass
            
            if cookie_clicked:
                logger.info("⏳ Waiting for modal to close...")
                await page.wait_for_timeout(3000)
                
                # Show alert
                await page.evaluate('alert("Cookie ist weg! (hoffentlich)")')
                
                # Wait for user to dismiss alert
                page.on('dialog', lambda dialog: dialog.accept())
                await page.wait_for_timeout(2000)
                
                # Take screenshot after
                await page.screenshot(path='after_cookie_click.png')
                logger.info("📸 Screenshot saved: after_cookie_click.png")
                
                # Check if modal is really gone
                modal_exists = await page.evaluate('''
                    () => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        return buttons.some(btn => 
                            btn.textContent.includes('Alle Cookies akzeptieren') &&
                            btn.offsetParent !== null
                        );
                    }
                ''')
                
                if modal_exists:
                    logger.error("❌ Cookie modal is STILL VISIBLE!")
                else:
                    logger.info("✅ Cookie modal is GONE!")
                
                # Test navigation to another page
                logger.info("\n🧪 Testing navigation to job search page...")
                await page.goto('https://www.arbeitsagentur.de/jobsuche/', wait_until='domcontentloaded')
                await page.wait_for_timeout(3000)
                
                # Check if cookie modal appears again
                modal_on_new_page = await page.evaluate('''
                    () => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        return buttons.some(btn => 
                            btn.textContent.includes('Alle Cookies akzeptieren') &&
                            btn.offsetParent !== null
                        );
                    }
                ''')
                
                if modal_on_new_page:
                    logger.error("❌ Cookie modal appeared AGAIN on new page!")
                    await page.screenshot(path='cookie_modal_reappeared.png')
                else:
                    logger.info("✅ No cookie modal on new page - cookies working!")
                
            else:
                logger.error("❌ Could not click any cookie button")
                
                # List all visible buttons for debugging
                visible_buttons = await page.evaluate('''
                    () => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        return buttons
                            .filter(btn => btn.offsetParent !== null)
                            .map(btn => ({
                                text: btn.textContent.trim(),
                                testId: btn.getAttribute('data-testid'),
                                classes: btn.className
                            }));
                    }
                ''')
                
                logger.info("Visible buttons on page:")
                for btn in visible_buttons:
                    logger.info(f"  - Text: '{btn['text']}', TestID: {btn['testId']}, Classes: {btn['classes']}")
            
            logger.info("\n⏳ Keeping browser open for manual inspection...")
            await page.wait_for_timeout(10000)
            
        finally:
            await context.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(test_cookie_acceptance())