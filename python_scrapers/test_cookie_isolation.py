#!/usr/bin/env python3
"""Demonstrate cookie folder isolation for parallel workers"""

import asyncio
import os
from pathlib import Path
from base_scraper import BaseScraper
from newest_jobs_scraper import NewestJobsScraper
from historical_employer_scraper import HistoricalEmployerScraper
from config import COOKIE_BASE_DIR


def show_cookie_directories():
    """Show all cookie directories"""
    print("\n📁 Current cookie directories:")
    if COOKIE_BASE_DIR.exists():
        for path in sorted(COOKIE_BASE_DIR.iterdir()):
            if path.is_dir():
                print(f"   - {path.name}")
                # Check contents
                state = path / 'state.json'
                marker = path / 'cookies_accepted'
                print(f"     State file: {state.exists()}")
                print(f"     Cookie marker: {marker.exists()}")
    else:
        print("   (none)")


def test_unique_cookie_folders():
    """Test that different scrapers get unique cookie folders"""
    print("\n🧪 Testing unique cookie folder creation")
    
    # Test 1: Same scraper name, different process IDs
    scraper1 = BaseScraper('test-scraper', process_id=1001)
    scraper2 = BaseScraper('test-scraper', process_id=1002)
    
    print(f"\n📍 Same scraper name, different process IDs:")
    print(f"   Scraper 1: {scraper1.cookie_dir}")
    print(f"   Scraper 2: {scraper2.cookie_dir}")
    print(f"   ✅ Different folders: {scraper1.cookie_dir != scraper2.cookie_dir}")
    
    # Test 2: Different scraper names, same process ID
    scraper3 = BaseScraper('scraper-A', process_id=2000)
    scraper4 = BaseScraper('scraper-B', process_id=2000)
    
    print(f"\n📍 Different scraper names, same process ID:")
    print(f"   Scraper A: {scraper3.cookie_dir}")
    print(f"   Scraper B: {scraper4.cookie_dir}")
    print(f"   ✅ Different folders: {scraper3.cookie_dir != scraper4.cookie_dir}")
    
    # Test 3: Production scrapers with auto-generated IDs
    newest1 = NewestJobsScraper()
    newest2 = NewestJobsScraper()
    historical1 = HistoricalEmployerScraper()
    
    print(f"\n📍 Production scrapers with auto-generated IDs:")
    print(f"   Newest Jobs 1: {newest1.cookie_dir}")
    print(f"   Newest Jobs 2: {newest2.cookie_dir}")
    print(f"   Historical 1: {historical1.cookie_dir}")
    print(f"   ✅ All different: {len({newest1.cookie_dir, newest2.cookie_dir, historical1.cookie_dir}) == 3}")


async def simulate_parallel_workers():
    """Simulate parallel workers scenario"""
    print("\n🏭 Simulating parallel workers scenario")
    
    # Clean up old test directories
    for path in COOKIE_BASE_DIR.glob('parallel-test-*'):
        if path.is_dir():
            import shutil
            shutil.rmtree(path)
    
    # Create 3 parallel workers
    workers = []
    for i in range(3):
        # Each worker gets unique process ID
        process_id = f"worker-{i}-pid{os.getpid()}"
        worker = BaseScraper('parallel-test', process_id=process_id)
        workers.append(worker)
        print(f"   Worker {i}: {worker.cookie_dir.name}")
    
    # Verify all have different directories
    cookie_dirs = [w.cookie_dir for w in workers]
    unique_dirs = set(cookie_dirs)
    print(f"\n   ✅ All workers have unique directories: {len(unique_dirs) == len(workers)}")
    
    # Clean up
    for worker in workers:
        del worker


def main():
    """Run all tests"""
    print("=" * 60)
    print("🍪 Cookie Folder Isolation Test")
    print("=" * 60)
    
    # Show current state
    show_cookie_directories()
    
    # Test unique folder creation
    test_unique_cookie_folders()
    
    # Test parallel workers
    asyncio.run(simulate_parallel_workers())
    
    # Show final state
    show_cookie_directories()
    
    print("\n✅ All tests completed!")
    print("\n💡 Key points:")
    print("   1. Each scraper instance gets a unique cookie folder")
    print("   2. Folder name = scraper_name + process_id")
    print("   3. Process ID can be auto-generated or manually specified")
    print("   4. Parallel workers won't interfere with each other")


if __name__ == '__main__':
    main()