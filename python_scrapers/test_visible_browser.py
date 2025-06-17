#!/usr/bin/env python3
"""Test that browser runs visible and stays open"""

import asyncio
import logging
from base_scraper import BaseScraper
from config import BROWSER_HEADLESS

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_visible_browser():
    """Test with a single visible browser"""
    
    logger.info(f"🔍 Browser headless mode: {BROWSER_HEADLESS}")
    logger.info("🚀 Starting visible browser test...")
    
    async with BaseScraper('visible-test') as scraper:
        logger.info(f"📁 Cookie directory: {scraper.cookie_dir}")
        
        # Navigate to a test page
        test_url = "https://www.arbeitsagentur.de/jobsuche/"
        logger.info(f"🔗 Navigating to: {test_url}")
        
        await scraper.page.goto(test_url)
        
        # Add visible indicator
        await scraper.page.evaluate('''() => {
            const div = document.createElement('div');
            div.innerHTML = '✅ BROWSER IS VISIBLE<br>Headless = False<br>Press Ctrl+C to close';
            div.style.position = 'fixed';
            div.style.top = '50%';
            div.style.left = '50%';
            div.style.transform = 'translate(-50%, -50%)';
            div.style.padding = '30px';
            div.style.background = 'green';
            div.style.color = 'white';
            div.style.fontSize = '24px';
            div.style.fontWeight = 'bold';
            div.style.zIndex = '99999';
            div.style.borderRadius = '10px';
            div.style.textAlign = 'center';
            document.body.appendChild(div);
        }''')
        
        logger.info("✅ Browser is now visible!")
        logger.info("🌐 Browser will stay open until you press Ctrl+C")
        logger.info("👁️ You should see a green message in the browser window")
        
        # Keep browser open indefinitely
        try:
            await asyncio.sleep(86400)  # 24 hours
        except KeyboardInterrupt:
            logger.info("\n👋 Closing browser...")


if __name__ == '__main__':
    try:
        asyncio.run(test_visible_browser())
    except KeyboardInterrupt:
        print("\n✅ Test completed!")