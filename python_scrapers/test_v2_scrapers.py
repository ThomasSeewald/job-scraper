#!/usr/bin/env python3
"""Test script for V2 scrapers"""

import asyncio
import logging

logging.basicConfig(level=logging.INFO)

async def test_targeted_scraper():
    """Test the targeted scraper V2"""
    from targeted_scraper_v2 import TargetedScraperV2
    
    # Test with a few reference numbers
    test_refs = [
        "10-1153867-1000694308-S",  # Example ref
        "10000-1200256489-S",        # Another example
    ]
    
    print("Testing Targeted Scraper V2...")
    print(f"Processing {len(test_refs)} jobs")
    
    scraper = TargetedScraperV2(
        ref_numbers=test_refs,
        worker_id=99,
        delay_seconds=0,
        headless=False  # Show browser for testing
    )
    
    await scraper.run()

async def test_unified_scraper():
    """Test the unified scraper V2"""
    from unified_scraper_v2 import UnifiedScraperV2
    
    print("\nTesting Unified Scraper V2...")
    print("Processing 2 employers")
    
    scraper = UnifiedScraperV2(
        worker_id=0,
        mode='batch',
        batch_size=2,
        delay_seconds=0,
        headless=False  # Show browser for testing
    )
    
    await scraper.run()

async def main():
    """Run all tests"""
    print("Testing V2 Scrapers\n" + "="*50)
    
    # Test targeted scraper
    # await test_targeted_scraper()
    
    # Test unified scraper
    await test_unified_scraper()
    
    print("\nAll tests completed!")

if __name__ == '__main__':
    asyncio.run(main())