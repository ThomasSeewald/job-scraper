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


async def test_20_different_employers():
    """Test 20 jobs from 20 DIFFERENT employers to see CAPTCHA pattern"""
    
    logger.info("🚀 Starting test with 20 DIFFERENT employers")
    
    # Get fresh jobs from database
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        database=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password']
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get ONE job per employer, for 20 different employers
    query = """
        WITH ranked_jobs AS (
            SELECT 
                refnr, 
                titel, 
                arbeitgeber, 
                arbeitsort_ort,
                ROW_NUMBER() OVER (PARTITION BY arbeitgeber ORDER BY aktuelleveroeffentlichungsdatum DESC) as rn
            FROM job_scrp_arbeitsagentur_jobs_v2
            WHERE refnr IS NOT NULL
              AND (externeurl IS NULL OR externeurl = '')
              AND old = false
              AND is_active = true
        )
        SELECT refnr, titel, arbeitgeber, arbeitsort_ort
        FROM ranked_jobs
        WHERE rn = 1
        ORDER BY arbeitgeber
        LIMIT 20
    """
    
    cursor.execute(query)
    jobs = cursor.fetchall()
    cursor.close()
    conn.close()
    
    logger.info(f"📋 Found {len(jobs)} jobs from {len(jobs)} DIFFERENT employers")
    
    # Show the employers
    logger.info("\n🏢 Employers to test:")
    for i, job in enumerate(jobs, 1):
        logger.info(f"   {i}. {job['arbeitgeber']}")
    
    async with BaseScraper('different-employers-test') as scraper:
        captcha_count = 0
        success_count = 0
        emails_found = 0
        
        for i, job in enumerate(jobs, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"📄 Employer {i}/20: {job['arbeitgeber']}")
            logger.info(f"   Job: {job['titel'][:50]}...")
            
            url = f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{job['refnr']}"
            
            # Small wait between different employers
            if i > 1:
                await asyncio.sleep(2)
            
            try:
                # Navigate to job page
                success = await scraper.navigate_to_job(url)
                
                if not success:
                    logger.warning("⚠️ 404 - Job no longer exists")
                    continue
                
                success_count += 1
                
                # Check for CAPTCHA
                captcha_present = await scraper.page.query_selector('img[src*="captcha"]')
                if captcha_present:
                    captcha_count += 1
                    logger.info(f"🔐 CAPTCHA #{captcha_count} on employer #{i}: {job['arbeitgeber']}")
                else:
                    logger.info("✅ NO CAPTCHA - Direct access!")
                    
                    # Extract emails
                    email_data = await scraper.extract_emails_from_page(job['arbeitgeber'])
                    if email_data['has_emails']:
                        emails_found += 1
                        logger.info(f"📧 Email: {email_data['primary_email']}")
                    
            except Exception as e:
                logger.error(f"❌ Error: {e}")
                
        logger.info(f"\n{'='*60}")
        logger.info("🎯 Test Results:")
        logger.info(f"   - Different employers tested: {len(jobs)}")
        logger.info(f"   - Successful page loads: {success_count}")
        logger.info(f"   - CAPTCHAs encountered: {captcha_count}")
        logger.info(f"   - Employers with emails: {emails_found}")
        logger.info(f"\n📊 CAPTCHA Analysis:")
        logger.info(f"   - Expected: 1 CAPTCHA for all 20 employers")
        logger.info(f"   - Actual: {captcha_count} CAPTCHAs")
        logger.info(f"   - Result: {'✅ SUCCESS' if captcha_count <= 1 else '❌ FAILED - Multiple CAPTCHAs'}")


if __name__ == '__main__':
    asyncio.run(test_20_different_employers())