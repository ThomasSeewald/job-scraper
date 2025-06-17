import asyncio
import logging
from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_single_job_with_delays():
    """Test a single job with proper delays to avoid rate limiting"""
    
    # Fresh job URL
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting single job test with proper delays")
    logger.info("⏳ Initial delay of 30 seconds to avoid rate limiting...")
    await asyncio.sleep(30)
    
    async with BaseScraper('delay-test') as scraper:
        logger.info(f"\n{'='*60}")
        logger.info(f"Testing URL: {test_url}")
        
        try:
            # Use the proper navigation method that handles cookies and CAPTCHA
            logger.info("🔗 Navigating to job page...")
            success = await scraper.navigate_to_job(test_url)
            
            if not success:
                logger.error("❌ Navigation failed (404 or other error)")
                return
            
            # The navigate_to_job method already handles CAPTCHA
            logger.info("📄 Page loaded successfully")
            
            # Take screenshot
            await scraper.page.screenshot(path='test_with_delays.png')
            logger.info("📸 Screenshot saved: test_with_delays.png")
            
            # Get page title
            title = await scraper.page.title()
            logger.info(f"📄 Page title: {title}")
            
            # Try to extract emails
            email_data = await scraper.extract_emails_from_page()
            logger.info(f"📧 Email extraction result: {email_data}")
            
            # Keep browser open for a bit to inspect
            logger.info("⏳ Keeping browser open for 10 seconds for inspection...")
            await asyncio.sleep(10)
                    
        except Exception as e:
            logger.error(f"❌ Error testing URL: {e}")
            
    logger.info(f"\n{'='*60}")
    logger.info("🎯 Test completed!")
    logger.info("Check test_with_delays.png to see the result")


if __name__ == '__main__':
    asyncio.run(test_single_job_with_delays())