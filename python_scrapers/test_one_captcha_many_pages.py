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


async def test_one_captcha_many_pages():
    """Test that one CAPTCHA solve gives access to many pages"""
    
    logger.info("🚀 Starting 1 CAPTCHA → 19 pages test")
    
    # Get fresh jobs from database
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get 20 newest VALID jobs (no external URLs, active jobs only)
    query = """
        SELECT refnr, titel, arbeitgeber, arbeitsort_ort
        FROM job_scrp_arbeitsagentur_jobs_v2
        WHERE refnr IS NOT NULL
          AND (externeurl IS NULL OR externeurl = '')
          AND old = false
          AND is_active = true
        ORDER BY aktuelleveroeffentlichungsdatum DESC
        LIMIT 20
    """
    
    cursor.execute(query)
    jobs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    logger.info(f"📋 Found {len(jobs)} fresh VALID jobs (no external URLs)")
    
    if len(jobs) < 20:
        logger.warning(f"⚠️ Only found {len(jobs)} valid jobs, need 20 for proper test")
    
    async with BaseScraper('one-captcha-test') as scraper:
        captcha_count = 0
        success_count = 0
        emails_found = 0
        
        for i, job in enumerate(jobs, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"📄 Page {i}/{len(jobs)}")
            logger.info(f"   Job: {job['titel'][:50]}...")
            logger.info(f"   Employer: {job['arbeitgeber']}")
            logger.info(f"   Location: {job['arbeitsort_ort']}")
            
            url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
            
            # Small wait between pages
            if i > 1:
                await asyncio.sleep(1.5)
            
            try:
                # Navigate to job page
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ 404 - Job no longer exists, skipping")
                    continue
                
                success_count += 1
                
                # Check for CAPTCHA
                captcha_present = await scraper.page.query_selector('img[src*="captcha"]')
                if captcha_present:
                    captcha_count += 1
                    logger.info(f"🔐 CAPTCHA #{captcha_count} detected on page {i}")
                else:
                    logger.info("✅ NO CAPTCHA - Direct access to job data!")
                    
                    # Extract emails
                    email_data = await scraper.extract_emails_from_page(job['arbeitgeber'])
                    if email_data['has_emails']:
                        emails_found += 1
                        logger.info(f"📧 Emails found: {email_data['emails']}")
                    else:
                        logger.info("📭 No emails in this job")
                    
            except Exception as e:
                logger.error(f"❌ Error: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info("🎯 Test Results:")
        logger.info(f"   - Total pages attempted: {len(jobs)}")
        logger.info(f"   - Successful page loads: {success_count}")
        logger.info(f"   - CAPTCHAs encountered: {captcha_count}")
        logger.info(f"   - Pages with emails: {emails_found}")
        logger.info(f"\n{'🎉' if captcha_count <= 1 else '❌'} Expected: 1 CAPTCHA, Got: {captcha_count} CAPTCHAs")
        logger.info(f"{'✅' if captcha_count <= 1 else '❌'} Cookie persistence: {'SUCCESS' if captcha_count <= 1 else 'FAILED'}")


if __name__ == '__main__':
    asyncio.run(test_one_captcha_many_pages())