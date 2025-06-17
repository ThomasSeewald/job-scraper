import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_check_dom_after_scroll():
    """Test to check DOM after scrolling"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting DOM check test")
    
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
        
        # Click cookie away
        logger.info("🍪 Clicking cookie away...")
        try:
            cookie_button = await page.wait_for_selector(
                'button[data-testid="bahf-cookie-disclaimer-btn-alle"]',
                timeout=5000,
                state='visible'
            )
            await cookie_button.click()
            logger.info("✅ Cookie button clicked")
            await page.wait_for_timeout(3000)  # Give more time for content to load
        except:
            logger.warning("⚠️ No cookie button found")
        
        # Scroll down to jobdetails-kontaktdaten-container
        logger.info("📜 Scrolling to #jobdetails-kontaktdaten-container...")
        await page.evaluate('''
            const element = document.getElementById('jobdetails-kontaktdaten-container');
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                console.log('Scrolled to jobdetails-kontaktdaten-container');
            } else {
                console.log('Could not find jobdetails-kontaktdaten-container');
            }
        ''')
        
        # Wait for scroll and any lazy loading
        logger.info("⏳ Waiting for content to load after scroll...")
        await page.wait_for_timeout(3000)
        
        # Check DOM for CAPTCHA elements
        logger.info("🔍 Checking DOM for CAPTCHA elements...")
        
        # Multiple ways to check for CAPTCHA
        captcha_checks = await page.evaluate('''
            () => {
                const results = {
                    captchaImage: !!document.querySelector('img[src*="/s/captcha/image"]'),
                    captchaImageSrc: document.querySelector('img[src*="/s/captcha/image"]')?.src || null,
                    captchaInput: !!document.querySelector('input[name="captcha"]'),
                    sicherheitsabfrage: Array.from(document.querySelectorAll('h3')).some(h3 => h3.textContent.includes('Sicherheitsabfrage')),
                    allImages: Array.from(document.querySelectorAll('img')).map(img => img.src).filter(src => src.includes('captcha')),
                    kontaktdatenContainer: !!document.getElementById('jobdetails-kontaktdaten-container'),
                    kontaktdatenVisible: document.getElementById('jobdetails-kontaktdaten-container')?.offsetParent !== null
                };
                
                // Also check for any element with captcha in class or id
                const captchaElements = document.querySelectorAll('[class*="captcha"], [id*="captcha"]');
                results.captchaElementsCount = captchaElements.length;
                
                // Check all h3 elements for security check text
                const h3Elements = Array.from(document.querySelectorAll('h3')).map(h3 => h3.textContent);
                results.h3Texts = h3Elements;
                
                return results;
            }
        ''')
        
        logger.info(f"📊 CAPTCHA check results:")
        logger.info(f"   - CAPTCHA image found: {captcha_checks['captchaImage']}")
        logger.info(f"   - CAPTCHA image src: {captcha_checks['captchaImageSrc']}")
        logger.info(f"   - CAPTCHA input found: {captcha_checks['captchaInput']}")
        logger.info(f"   - Sicherheitsabfrage found: {captcha_checks['sicherheitsabfrage']}")
        logger.info(f"   - CAPTCHA images in DOM: {captcha_checks['allImages']}")
        logger.info(f"   - Kontaktdaten container found: {captcha_checks['kontaktdatenContainer']}")
        logger.info(f"   - Kontaktdaten container visible: {captcha_checks['kontaktdatenVisible']}")
        logger.info(f"   - Elements with 'captcha' in class/id: {captcha_checks['captchaElementsCount']}")
        
        # Take screenshot of current view
        await page.screenshot(path='after_scroll_captcha_check.png', full_page=False)
        logger.info("📸 Screenshot saved: after_scroll_captcha_check.png")
        
        # Also try to find CAPTCHA with different selectors
        logger.info("\n🔍 Additional CAPTCHA searches:")
        
        # Check if CAPTCHA is in the viewport
        captcha_in_viewport = await page.evaluate('''
            () => {
                const captchaImg = document.querySelector('img[src*="captcha"]');
                if (!captchaImg) return false;
                
                const rect = captchaImg.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= window.innerHeight;
            }
        ''')
        logger.info(f"   - CAPTCHA in viewport: {captcha_in_viewport}")
        
        # If CAPTCHA found, show alert
        if captcha_checks['captchaImage'] or len(captcha_checks['allImages']) > 0:
            logger.info("✅ CAPTCHA detected! Showing alert...")
            await page.evaluate('alert("CAPTCHA found! Click OK to continue")')
        else:
            logger.info("❌ No CAPTCHA found in DOM")
        
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
    asyncio.run(test_check_dom_after_scroll())