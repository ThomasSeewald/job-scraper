import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_debug_flicker():
    """Debug test to understand the flickering"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting debug flicker test")
    
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
    
    # Monitor network activity
    page.on('response', lambda response: logger.info(f"📡 Network: {response.status} {response.url[:80]}...") if response.status >= 300 else None)
    page.on('domcontentloaded', lambda: logger.info("📄 DOM content loaded"))
    page.on('load', lambda: logger.info("📄 Page fully loaded"))
    
    try:
        # Navigate to job page
        logger.info(f"🔗 Navigating to: {test_url}")
        await page.goto(test_url, wait_until='domcontentloaded')
        logger.info("✅ Initial navigation complete")
        
        await page.wait_for_timeout(1000)
        logger.info("⏳ Waited 1 second after navigation")
        
        # Click cookie away
        logger.info("🍪 Looking for cookie button...")
        try:
            cookie_button = await page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=5000,
                state='visible'
            )
            logger.info("✅ Cookie button found, clicking...")
            await cookie_button.click()
            logger.info("✅ Cookie button clicked")
            
            # Monitor what happens after cookie click
            logger.info("👀 Monitoring page changes after cookie click...")
            
            # Take screenshots at intervals
            for i in range(4):
                await page.wait_for_timeout(500)
                await page.screenshot(path=f'flicker_debug_{i}.png')
                logger.info(f"📸 Screenshot {i} taken after {(i+1)*0.5} seconds")
                
                # Check if URL changed
                current_url = page.url
                logger.info(f"🔗 Current URL: {current_url}")
                
                # Check page visibility
                is_visible = await page.evaluate('() => document.visibilityState')
                logger.info(f"👁️ Page visibility: {is_visible}")
                
        except Exception as e:
            logger.warning(f"⚠️ Cookie handling error: {e}")
        
        # Keep browser open
        logger.info("\n🌐 Keeping browser open for manual inspection...")
        await asyncio.sleep(300)  # Keep open for 5 minutes
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await browser.close()
        await playwright.stop()


if __name__ == '__main__':
    asyncio.run(test_debug_flicker())