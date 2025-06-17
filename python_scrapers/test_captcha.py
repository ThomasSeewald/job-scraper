import asyncio
import logging
from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_captcha_solving():
    """Test CAPTCHA solving functionality"""
    
    # Fresh jobs from API that are likely to have CAPTCHAs
    test_urls = [
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S",      # aiutanda - likely to have CAPTCHA
    ]
    
    async with BaseScraper('captcha-test') as scraper:
        for i, url in enumerate(test_urls):
            logger.info(f"\n{'='*60}")
            logger.info(f"Testing URL {i+1}/{len(test_urls)}: {url}")
            
            # Wait before navigating (except for first page)
            if i > 0:
                wait_time = 10  # 10 seconds between pages
                logger.info(f"⏳ Waiting {wait_time} seconds before next page...")
                await asyncio.sleep(wait_time)
            
            try:
                # Use the proper navigation method that handles cookies and CAPTCHA
                logger.info("🔗 Navigating using navigate_to_job method...")
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.error("❌ Navigation failed (404 or other error)")
                    continue
                
                # The navigate_to_job method already handles CAPTCHA
                # Let's check if there was a CAPTCHA by looking at the page
                logger.info("📄 Checking page content...")
                
                # Take screenshot
                await scraper.page.screenshot(path='page_content.png')
                logger.info("📸 Screenshot saved: page_content.png")
                
                # Get page title
                title = await scraper.page.title()
                logger.info(f"📄 Page title: {title}")
                
                # Try to extract emails
                email_data = await scraper.extract_emails_from_page()
                logger.info(f"📧 Email extraction result: {email_data}")
                        
            except Exception as e:
                logger.error(f"❌ Error testing URL: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info("🎯 CAPTCHA test completed!")
        logger.info("Check the screenshots to verify CAPTCHA solving worked")


if __name__ == '__main__':
    asyncio.run(test_captcha_solving())