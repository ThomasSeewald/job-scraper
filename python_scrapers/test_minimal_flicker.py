import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_minimal_flicker():
    """Minimal test to observe natural page behavior"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting minimal flicker test")
    
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
        logger.info("✅ Navigation complete")
        
        # Wait for cookie button to appear
        await page.wait_for_timeout(1000)
        
        # Click cookie away
        logger.info("🍪 Clicking cookie button...")
        try:
            cookie_button = await page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=5000,
                state='visible'
            )
            await cookie_button.click()
            logger.info("✅ Cookie clicked - now observing page behavior...")
            
            # Just wait and observe without any interference
            logger.info("👀 Observing page for 10 seconds without interference...")
            await page.wait_for_timeout(10000)
            
        except Exception as e:
            logger.warning(f"⚠️ Cookie error: {e}")
        
        # Check final state
        logger.info("\n📊 Final page state:")
        title = await page.title()
        logger.info(f"   - Title: {title}")
        
        # Check for CAPTCHA
        captcha_present = await page.query_selector('img[src*="captcha"]')
        logger.info(f"   - CAPTCHA present: {captcha_present is not None}")
        
        # Keep browser open
        logger.info("\n🌐 Keeping browser open for manual inspection...")
        await asyncio.sleep(300)
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
    finally:
        await browser.close()
        await playwright.stop()


if __name__ == '__main__':
    asyncio.run(test_minimal_flicker())