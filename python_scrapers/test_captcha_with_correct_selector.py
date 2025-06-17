import asyncio
import logging
from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_captcha_with_correct_selector():
    """Test CAPTCHA solving with correct selector"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting CAPTCHA test with correct selector")
    logger.info("⏳ Initial delay of 30 seconds to avoid rate limiting...")
    await asyncio.sleep(30)
    
    async with BaseScraper('captcha-selector-test') as scraper:
        logger.info(f"\n{'='*60}")
        logger.info(f"Testing URL: {test_url}")
        
        try:
            # Navigate to job page
            logger.info("🔗 Navigating to job page...")
            success = await scraper.navigate_to_job(test_url)
            
            if not success:
                logger.error("❌ Navigation failed (404 or other error)")
                return
            
            logger.info("✅ Navigation successful")
            
            # Take screenshot
            await scraper.page.screenshot(path='captcha_test_result.png')
            logger.info("📸 Screenshot saved: captcha_test_result.png")
            
            # Get page title
            title = await scraper.page.title()
            logger.info(f"📄 Page title: {title}")
            
            # Check what's on the page
            page_info = await scraper.page.evaluate('''
                () => {
                    const captchaImg = document.querySelector('img[src*="captcha"]');
                    const captchaInput = document.querySelector('input[name="captcha"]');
                    const submitButton = document.querySelector('button[type="submit"]');
                    
                    return {
                        hasCaptchaImage: !!captchaImg,
                        captchaImageSrc: captchaImg?.src || null,
                        hasCaptchaInput: !!captchaInput,
                        hasSubmitButton: !!submitButton,
                        submitButtonText: submitButton?.textContent || null
                    };
                }
            ''')
            
            logger.info("📊 Page analysis:")
            logger.info(f"   - CAPTCHA image present: {page_info['hasCaptchaImage']}")
            logger.info(f"   - CAPTCHA image URL: {page_info['captchaImageSrc']}")
            logger.info(f"   - CAPTCHA input present: {page_info['hasCaptchaInput']}")
            logger.info(f"   - Submit button present: {page_info['hasSubmitButton']}")
            logger.info(f"   - Submit button text: {page_info['submitButtonText']}")
            
            # Extract emails if page loaded successfully
            if not page_info['hasCaptchaImage']:
                email_data = await scraper.extract_emails_from_page()
                logger.info(f"📧 Email extraction result: {email_data}")
            else:
                logger.info("⏸️ CAPTCHA present - would need to be solved to see content")
                
        except Exception as e:
            logger.error(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            
    logger.info(f"\n{'='*60}")
    logger.info("🎯 Test completed!")


if __name__ == '__main__':
    asyncio.run(test_captcha_with_correct_selector())