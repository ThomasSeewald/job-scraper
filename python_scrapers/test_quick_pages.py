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


async def test_quick_pages():
    """Quick test of multiple pages after CAPTCHA solving"""
    
    logger.info("🚀 Starting quick pages test")
    
    # Get fresh jobs from database
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get 10 newest jobs
    query = """
        SELECT refnr, titel, arbeitgeber
        FROM job_scrp_arbeitsagentur_jobs_v2
        WHERE refnr IS NOT NULL
          AND (externeurl IS NULL OR externeurl = '')
          AND old = false
        ORDER BY aktuelleveroeffentlichungsdatum DESC
        LIMIT 10
    """
    
    cursor.execute(query)
    jobs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    logger.info(f"📋 Found {len(jobs)} fresh jobs")
    
    async with BaseScraper('quick-test') as scraper:
        captcha_count = 0
        
        for i, job in enumerate(jobs, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"📄 Job {i}/{len(jobs)}: {job['titel'][:50]}...")
            
            url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
            
            # Small wait between pages
            if i > 1:
                await asyncio.sleep(1)
            
            try:
                # Navigate to job page
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ 404 error")
                    continue
                
                # Quick check for CAPTCHA
                captcha_present = await scraper.page.query_selector('img[src*="captcha"]')
                if captcha_present:
                    captcha_count += 1
                    logger.info("❌ CAPTCHA present!")
                else:
                    logger.info("✅ No CAPTCHA - page loaded successfully")
                    
                    # Try to get contact info
                    contact_text = await scraper.page.evaluate('''
                        () => {
                            const container = document.getElementById('jobdetails-kontaktdaten-container');
                            return container ? container.innerText.substring(0, 100) : null;
                        }
                    ''')
                    
                    if contact_text and '@' in contact_text:
                        logger.info("📧 Contact info available!")
                    
            except Exception as e:
                logger.error(f"❌ Error: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info(f"🎯 Test completed! CAPTCHAs found: {captcha_count}")
        logger.info(f"✅ Cookie persistence: {'SUCCESS' if captcha_count == 0 else 'FAILED'}")


if __name__ == '__main__':
    asyncio.run(test_quick_pages())