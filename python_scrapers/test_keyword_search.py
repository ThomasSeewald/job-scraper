#!/usr/bin/env python3
"""Test script for keyword search functionality"""

import asyncio
import logging
from playwright.async_api import async_playwright

from email_extractor import EmailExtractor
from keyword_searcher import KeywordSearcher

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_keyword_search():
    """Test keyword search on various domains"""
    
    # Test domains that likely have impressum/kontakt pages
    test_domains = [
        'bosch.de',           # Large German company
        'siemens.com',        # International company
        'volkswagen.de',      # German automotive
        'sap.com',            # Software company
        'lidl.de'             # Retail company
    ]
    
    # Initialize tools
    email_extractor = EmailExtractor()
    keyword_searcher = KeywordSearcher(email_extractor)
    
    # Initialize browser
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    
    logger.info("Starting keyword search tests...\n")
    
    for domain in test_domains:
        logger.info(f"{'='*60}")
        logger.info(f"Testing domain: {domain}")
        
        try:
            # Run keyword search
            results = await keyword_searcher.search_domain_for_emails(page, domain)
            
            # Display results
            if results['success']:
                logger.info(f"✅ SUCCESS - Found {results['email_count']} unique emails")
                logger.info(f"Keywords found: {', '.join(results['keywords_found'])}")
                
                # Show emails by keyword
                for keyword, emails in results['emails_by_keyword'].items():
                    logger.info(f"\n{keyword.upper()} emails ({len(emails)}):")
                    for email in emails[:3]:  # Show first 3
                        logger.info(f"  - {email}")
                    if len(emails) > 3:
                        logger.info(f"  ... and {len(emails) - 3} more")
                        
                # Show unique emails summary
                logger.info(f"\nTotal unique emails: {results['email_count']}")
                if results['unique_emails']:
                    logger.info("Sample emails:")
                    for email in results['unique_emails'][:5]:
                        logger.info(f"  - {email}")
                    if len(results['unique_emails']) > 5:
                        logger.info(f"  ... and {len(results['unique_emails']) - 5} more")
            else:
                logger.info(f"❌ FAILED - {results.get('error', 'No emails found')}")
                
        except Exception as e:
            logger.error(f"Test failed for {domain}: {e}")
            
        logger.info("")
        await asyncio.sleep(2)  # Brief pause between tests
    
    # Cleanup
    await browser.close()
    await playwright.stop()
    
    logger.info("Test completed!")


async def test_specific_domain():
    """Test a specific domain provided as argument"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python test_keyword_search.py [domain]")
        print("Example: python test_keyword_search.py example.com")
        return
        
    domain = sys.argv[1]
    
    # Initialize tools
    email_extractor = EmailExtractor()
    keyword_searcher = KeywordSearcher(email_extractor)
    
    # Initialize browser
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    
    logger.info(f"Testing keyword search on: {domain}\n")
    
    # Run keyword search
    results = await keyword_searcher.search_domain_for_emails(page, domain)
    
    # Display detailed results
    logger.info("=== KEYWORD SEARCH RESULTS ===")
    logger.info(f"Success: {results['success']}")
    logger.info(f"Email count: {results['email_count']}")
    logger.info(f"Keywords found: {results['keywords_found']}")
    
    if results.get('error'):
        logger.error(f"Error: {results['error']}")
    
    # Show all results
    if results['emails_by_keyword']:
        logger.info("\n=== EMAILS BY KEYWORD ===")
        for keyword, emails in results['emails_by_keyword'].items():
            logger.info(f"\n{keyword.upper()} ({len(emails)} emails):")
            for email in emails:
                logger.info(f"  - {email}")
    
    if results['unique_emails']:
        logger.info(f"\n=== ALL UNIQUE EMAILS ({len(results['unique_emails'])}) ===")
        for email in results['unique_emails']:
            logger.info(f"  - {email}")
    
    # Generate formatted notes
    notes = keyword_searcher.format_keyword_notes(results)
    logger.info(f"\n=== DATABASE NOTES ===")
    logger.info(notes)
    
    # Cleanup
    await browser.close()
    await playwright.stop()


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        # Test specific domain
        asyncio.run(test_specific_domain())
    else:
        # Run default test suite
        asyncio.run(test_keyword_search())