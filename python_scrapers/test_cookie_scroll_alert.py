import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_cookie_scroll_alert():
    """Click cookie, scroll down immediately, show alert"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting cookie-scroll-alert test")
    
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=False,
        args=['--no-sandbox', '--disable-setuid-sandbox']
    )
    
    context = await browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        locale='de-DE',
        viewport={'width': 1920, 'height': 1080}
    )
    
    page = await context.new_page()
    
    try:
        # Navigate to job page
        logger.info(f"🔗 Navigating to: {test_url}")
        await page.goto(test_url, wait_until='domcontentloaded')
        
        # Small wait for cookie button
        await page.wait_for_timeout(500)
        
        # Click cookie and immediately scroll
        logger.info("🍪 Clicking cookie button...")
        try:
            cookie_button = await page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=3000,
                state='visible'
            )
            await cookie_button.click()
            logger.info("✅ Cookie clicked")
            
            # Immediately scroll down to contact section
            logger.info("📜 Scrolling to contact section...")
            await page.evaluate('''
                const element = document.getElementById('jobdetails-kontaktdaten-container');
                if (element) {
                    element.scrollIntoView({ behavior: 'instant', block: 'center' });
                    console.log('Scrolled to jobdetails-kontaktdaten-container');
                } else {
                    console.log('Could not find jobdetails-kontaktdaten-container');
                }
            ''')
            
            # Show alert immediately
            logger.info("🚨 Showing alert...")
            await page.evaluate('alert("Cookie clicked and scrolled - click OK to continue")')
            
        except Exception as e:
            logger.warning(f"⚠️ Error: {e}")
        
        # Keep browser open
        logger.info("\n🌐 Keeping browser open...")
        await asyncio.sleep(300)
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
    finally:
        await browser.close()
        await playwright.stop()


if __name__ == '__main__':
    asyncio.run(test_cookie_scroll_alert())