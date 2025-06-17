import asyncio
import logging
from base_scraper import BaseScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_multiple_pages():
    """Test loading multiple pages to verify cookie persistence"""
    
    # List of different job URLs to test
    test_urls = [
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/18430-0056778473-S",  # First with CAPTCHA
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031071302-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035854-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035858-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035862-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035865-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035870-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035875-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035880-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10002-8031035885-S",
    ]
    
    logger.info("🚀 Starting multiple pages test")
    logger.info(f"📋 Will test {len(test_urls)} job pages")
    
    async with BaseScraper('multi-page-test') as scraper:
        for i, url in enumerate(test_urls, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"📄 Page {i}/{len(test_urls)}")
            logger.info(f"🔗 URL: {url}")
            
            # Wait between pages (except first)
            if i > 1:
                wait_time = 3  # 3 seconds between pages
                logger.info(f"⏳ Waiting {wait_time} seconds before next page...")
                await asyncio.sleep(wait_time)
            
            try:
                # Navigate to job page
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ Navigation failed (404 or other error)")
                    continue
                
                # Get page info
                page_info = await scraper.page.evaluate('''
                    () => {
                        const title = document.title;
                        const hasCaptcha = !!document.querySelector('img[src*="captcha"]');
                        const hasCookieModal = !!document.querySelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                        const hasContactContainer = !!document.getElementById('jobdetails-kontaktdaten-container');
                        
                        // Try to get employer name
                        const employerElement = document.querySelector('h2.ba-heading-xs-prominent');
                        const employer = employerElement ? employerElement.textContent.trim() : 'Unknown';
                        
                        return {
                            title: title,
                            employer: employer,
                            hasCaptcha: hasCaptcha,
                            hasCookieModal: hasCookieModal,
                            hasContactContainer: hasContactContainer
                        };
                    }
                ''')
                
                logger.info(f"✅ Page loaded successfully")
                logger.info(f"   - Title: {page_info['title'][:60]}...")
                logger.info(f"   - Employer: {page_info['employer']}")
                logger.info(f"   - Has CAPTCHA: {page_info['hasCaptcha']}")
                logger.info(f"   - Has Cookie Modal: {page_info['hasCookieModal']}")
                logger.info(f"   - Has Contact Container: {page_info['hasContactContainer']}")
                
                # If no CAPTCHA, try to extract emails
                if not page_info['hasCaptcha']:
                    email_data = await scraper.extract_emails_from_page(page_info['employer'])
                    if email_data['has_emails']:
                        logger.info(f"   📧 Emails found: {email_data['emails']}")
                    else:
                        logger.info(f"   📧 No emails found")
                else:
                    logger.info("   ⏸️ CAPTCHA present - skipping email extraction")
                    
            except Exception as e:
                logger.error(f"❌ Error on page {i}: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info("🎯 Multiple pages test completed!")
        logger.info("📊 Summary:")
        logger.info(f"   - Total pages tested: {len(test_urls)}")
        logger.info("   - Cookie should have persisted after first page")
        logger.info("   - Check logs to verify no cookie modals appeared after page 1")


if __name__ == '__main__':
    asyncio.run(test_multiple_pages())