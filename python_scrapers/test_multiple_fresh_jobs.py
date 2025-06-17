import asyncio
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from base_scraper import BaseScraper
from config import DB_CONFIG

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_multiple_fresh_jobs():
    """Test loading multiple fresh job pages from database"""
    
    logger.info("🚀 Starting multiple fresh jobs test")
    
    # Get fresh jobs from database
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get 20 newest jobs without external URLs
    query = """
        SELECT refnr, titel, arbeitgeber, arbeitsort_ort
        FROM job_scrp_arbeitsagentur_jobs_v2
        WHERE refnr IS NOT NULL
          AND (externeurl IS NULL OR externeurl = '')
          AND old = false
        ORDER BY aktuelleveroeffentlichungsdatum DESC
        LIMIT 20
    """
    
    cursor.execute(query)
    jobs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    logger.info(f"📋 Found {len(jobs)} fresh jobs from database")
    
    if not jobs:
        logger.error("❌ No fresh jobs found in database")
        return
    
    async with BaseScraper('fresh-jobs-test') as scraper:
        captcha_count = 0
        success_count = 0
        email_count = 0
        
        for i, job in enumerate(jobs, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"📄 Job {i}/{len(jobs)}")
            logger.info(f"   - Title: {job['titel']}")
            logger.info(f"   - Employer: {job['arbeitgeber']}")
            logger.info(f"   - Location: {job['arbeitsort_ort']}")
            
            url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
            logger.info(f"🔗 URL: {url}")
            
            # Wait between pages (except first)
            if i > 1:
                wait_time = 2  # 2 seconds between pages
                logger.info(f"⏳ Waiting {wait_time} seconds before next page...")
                await asyncio.sleep(wait_time)
            
            try:
                # Navigate to job page
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ Navigation failed (404 or other error)")
                    continue
                
                success_count += 1
                
                # Get page info
                page_info = await scraper.page.evaluate('''
                    () => {
                        const hasCaptcha = !!document.querySelector('img[src*="captcha"]');
                        const hasCookieModal = !!document.querySelector('button[data-testid="bahf-cookie-disclaimer-btn-alle"]');
                        const hasContactContainer = !!document.getElementById('jobdetails-kontaktdaten-container');
                        
                        return {
                            hasCaptcha: hasCaptcha,
                            hasCookieModal: hasCookieModal,
                            hasContactContainer: hasContactContainer
                        };
                    }
                ''')
                
                logger.info(f"✅ Page loaded successfully")
                logger.info(f"   - Has CAPTCHA: {page_info['hasCaptcha']}")
                logger.info(f"   - Has Cookie Modal: {page_info['hasCookieModal']}")
                logger.info(f"   - Has Contact Container: {page_info['hasContactContainer']}")
                
                if page_info['hasCaptcha']:
                    captcha_count += 1
                    logger.info("   ⏸️ CAPTCHA present - would need solving")
                else:
                    # Try to extract emails
                    email_data = await scraper.extract_emails_from_page(job['arbeitgeber'])
                    if email_data['has_emails']:
                        email_count += 1
                        logger.info(f"   📧 Emails found: {email_data['emails']}")
                    else:
                        logger.info(f"   📧 No emails found")
                    
            except Exception as e:
                logger.error(f"❌ Error on job {i}: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info("🎯 Fresh jobs test completed!")
        logger.info("📊 Summary:")
        logger.info(f"   - Total jobs tested: {len(jobs)}")
        logger.info(f"   - Successful navigations: {success_count}")
        logger.info(f"   - Pages with CAPTCHA: {captcha_count}")
        logger.info(f"   - Pages with emails: {email_count}")
        logger.info(f"   - Cookie persistence: {'✅ Success' if captcha_count <= 1 else '❌ Failed - multiple CAPTCHAs'}")


if __name__ == '__main__':
    asyncio.run(test_multiple_fresh_jobs())