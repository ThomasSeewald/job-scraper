import asyncio
import logging
from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_complete_captcha_flow():
    """Test complete CAPTCHA flow with correct selectors"""
    
    test_url = "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S"
    
    logger.info("🚀 Starting complete CAPTCHA flow test")
    logger.info("⏳ Initial delay of 30 seconds to avoid rate limiting...")
    await asyncio.sleep(30)
    
    async with BaseScraper('complete-captcha-test') as scraper:
        logger.info(f"\n{'='*60}")
        logger.info(f"Testing URL: {test_url}")
        
        try:
            # Navigate to job page - this should handle cookies and CAPTCHA automatically
            logger.info("🔗 Navigating to job page (will handle cookies and CAPTCHA)...")
            success = await scraper.navigate_to_job(test_url)
            
            if not success:
                logger.error("❌ Navigation failed (404 or other error)")
                return
            
            logger.info("✅ Navigation successful")
            
            # Take screenshot after CAPTCHA handling
            await scraper.page.screenshot(path='after_captcha_handling.png')
            logger.info("📸 Screenshot saved: after_captcha_handling.png")
            
            # Get page title
            title = await scraper.page.title()
            logger.info(f"📄 Page title: {title}")
            
            # Check if we have contact information now
            contact_info = await scraper.page.evaluate('''
                () => {
                    const kontaktContainer = document.getElementById('jobdetails-kontaktdaten-container');
                    const hasContactData = kontaktContainer && kontaktContainer.textContent.includes('@');
                    
                    return {
                        hasKontaktContainer: !!kontaktContainer,
                        hasContactData: hasContactData,
                        containerText: kontaktContainer ? kontaktContainer.textContent.substring(0, 200) : null
                    };
                }
            ''')
            
            logger.info("📊 Contact information check:")
            logger.info(f"   - Kontakt container found: {contact_info['hasKontaktContainer']}")
            logger.info(f"   - Has contact data: {contact_info['hasContactData']}")
            if contact_info['containerText']:
                logger.info(f"   - Container preview: {contact_info['containerText']}...")
            
            # Extract emails
            email_data = await scraper.extract_emails_from_page()
            logger.info(f"📧 Email extraction result: {email_data}")
            
            # Keep browser open for inspection
            logger.info("\n⏸️ Keeping browser open for 30 seconds for inspection...")
            await asyncio.sleep(30)
                
        except Exception as e:
            logger.error(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            
    logger.info(f"\n{'='*60}")
    logger.info("🎯 Test completed!")


if __name__ == '__main__':
    asyncio.run(test_complete_captcha_flow())