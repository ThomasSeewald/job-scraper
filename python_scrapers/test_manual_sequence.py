import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_manual_sequence():
    """Test following exact manual sequence"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting manual sequence test")
    
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
        await page.wait_for_timeout(2000)
        
        # Step 1: Click cookie away
        logger.info("🍪 Step 1: Clicking cookie away...")
        try:
            cookie_button = await page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=5000,
                state='visible'
            )
            await cookie_button.click()
            logger.info("✅ Cookie button clicked")
            await page.wait_for_timeout(2000)
        except:
            logger.warning("⚠️ No cookie button found")
        
        # Step 2: Scroll down to jobdetails-kontaktdaten-container
        logger.info("📜 Step 2: Scrolling to #jobdetails-kontaktdaten-container...")
        await page.evaluate('''
            const element = document.getElementById('jobdetails-kontaktdaten-container');
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                console.log('Scrolled to jobdetails-kontaktdaten-container');
            } else {
                console.log('Could not find jobdetails-kontaktdaten-container');
            }
        ''')
        
        # Step 3: Wait a second
        logger.info("⏳ Step 3: Waiting 1 second...")
        await page.wait_for_timeout(1000)
        
        # Step 4: Check for CAPTCHA
        logger.info("🔍 Step 4: Checking for CAPTCHA...")
        captcha_found = await page.query_selector('img[src*="/s/captcha/image"]')
        if captcha_found:
            logger.info("✅ CAPTCHA found!")
        else:
            logger.info("❌ No CAPTCHA found")
            
        # Step 5: Alert(1)
        logger.info("🚨 Step 5: Showing alert(1)...")
        await page.evaluate('alert("1 - Ready for you to click")')
        logger.info("⏸️ Alert shown - please click it manually")
        
        # Keep browser open
        logger.info("🌐 Keeping browser open for manual inspection...")
        await asyncio.sleep(300)  # Keep open for 5 minutes
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
    finally:
        await browser.close()
        await playwright.stop()


if __name__ == '__main__':
    asyncio.run(test_manual_sequence())