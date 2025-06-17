import asyncio
import logging
import os
from pathlib import Path
from base_scraper import BaseScraper
from config import COOKIE_BASE_DIR

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker %(worker_id)s] - %(message)s'
)


async def worker_task(worker_id: int, job_urls: list):
    """Single worker task with its own cookie folder"""
    logger = logging.getLogger(f'Worker-{worker_id}')
    
    # Each worker gets a unique process_id to ensure separate cookie folders
    process_id = os.getpid() * 1000 + worker_id
    
    async with BaseScraper(f'parallel-worker', process_id=process_id) as scraper:
        logger.info(f"🚀 Starting with cookie dir: {scraper.cookie_dir}")
        
        for i, url in enumerate(job_urls, 1):
            logger.info(f"Processing job {i}/{len(job_urls)}")
            
            try:
                success = await scraper.navigate_to_job(url)
                if success:
                    # Check for CAPTCHA
                    captcha = await scraper.page.query_selector('img[src*="captcha"]')
                    if captcha:
                        logger.info("🔐 CAPTCHA found - would solve here")
                    else:
                        logger.info("✅ No CAPTCHA - direct access")
                        
                    # Small delay between jobs
                    await asyncio.sleep(1)
                    
            except Exception as e:
                logger.error(f"Error: {e}")
        
        logger.info("✅ Worker completed")


async def test_parallel_workers():
    """Test multiple parallel workers with separate cookie folders"""
    
    # Sample job URLs for testing
    test_jobs = [
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/15112-43434701-65-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/11850-328591-1694504-0-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1202698540-S",
        "https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1202698608-S",
    ]
    
    # Split jobs between workers
    num_workers = 3
    jobs_per_worker = len(test_jobs) // num_workers + 1
    
    print(f"\n🚀 Starting {num_workers} parallel workers")
    print(f"📁 Cookie base directory: {COOKIE_BASE_DIR}")
    
    # Show cookie directories before starting
    print("\n📁 Cookie directories will be created:")
    for worker_id in range(num_workers):
        process_id = os.getpid() * 1000 + worker_id
        cookie_dir = COOKIE_BASE_DIR / f'parallel-worker-{process_id}'
        print(f"   Worker {worker_id}: {cookie_dir}")
    
    # Create worker tasks
    tasks = []
    for worker_id in range(num_workers):
        start_idx = worker_id * jobs_per_worker
        end_idx = min(start_idx + jobs_per_worker, len(test_jobs))
        worker_jobs = test_jobs[start_idx:end_idx]
        
        if worker_jobs:
            task = worker_task(worker_id, worker_jobs)
            tasks.append(task)
    
    # Run all workers concurrently
    print(f"\n⏳ Running {len(tasks)} workers in parallel...")
    await asyncio.gather(*tasks)
    
    # Show created cookie directories
    print("\n✅ Test completed! Cookie directories created:")
    for path in COOKIE_BASE_DIR.glob('parallel-worker-*'):
        print(f"   - {path.name}")
        # Check if cookies were saved
        state_file = path / 'state.json'
        marker_file = path / 'cookies_accepted'
        print(f"     State saved: {state_file.exists()}")
        print(f"     Cookies handled: {marker_file.exists()}")


async def demonstrate_cookie_isolation():
    """Demonstrate that workers don't share cookies"""
    print("\n🔬 Demonstrating cookie isolation between workers")
    
    # Create two workers with different IDs
    worker1 = BaseScraper('isolation-test', process_id=1001)
    worker2 = BaseScraper('isolation-test', process_id=1002)
    
    print(f"\n📁 Worker 1 cookie dir: {worker1.cookie_dir}")
    print(f"📁 Worker 2 cookie dir: {worker2.cookie_dir}")
    print(f"✅ Directories are different: {worker1.cookie_dir != worker2.cookie_dir}")
    
    # Clean up
    del worker1
    del worker2


if __name__ == '__main__':
    # First demonstrate cookie isolation
    asyncio.run(demonstrate_cookie_isolation())
    
    # Then run parallel workers test
    asyncio.run(test_parallel_workers())