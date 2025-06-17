#!/usr/bin/env python3
"""Four window unified scraper with keyword search fallback"""

import asyncio
import logging
from playwright.async_api import async_playwright

from unified_scraper_with_keywords import UnifiedScraperWithKeywords

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - Worker-%(worker_id)s - %(message)s',
    defaults={'worker_id': 'X'}
)


class FourWindowScraperWithKeywords(UnifiedScraperWithKeywords):
    """Extended unified scraper with window positioning and keyword search"""
    
    def __init__(self, worker_id: int, **kwargs):
        super().__init__(worker_id=worker_id, **kwargs)
        
        # Window positions for 1920x1080 screen split into 4
        self.window_positions = [
            {'x': 0, 'y': 0},        # Top-left
            {'x': 960, 'y': 0},      # Top-right  
            {'x': 0, 'y': 540},      # Bottom-left
            {'x': 960, 'y': 540}     # Bottom-right
        ]
        
        # Worker colors
        self.worker_colors = ['red', 'blue', 'green', 'orange']
        
    async def initialize_browser(self):
        """Initialize browser with specific window position"""
        self.playwright = await async_playwright().start()
        
        # Launch browser with specific window position
        self.browser = await self.playwright.chromium.launch(
            headless=False,  # Always visible for 4-window
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                f'--window-position={self.window_positions[self.worker_id]["x"]},{self.window_positions[self.worker_id]["y"]}',
                '--window-size=960,540'
            ]
        )
        
        # Create context
        context_options = {
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'locale': 'de-DE',
            'viewport': {'width': 960, 'height': 540}
        }
        
        if self.state_file.exists():
            context_options['storage_state'] = str(self.state_file)
            
        self.context = await self.browser.new_context(**context_options)
        self.page = await self.context.new_page()
        
        # Add custom CSS for worker identification
        await self.page.add_init_script(f"""
            const style = document.createElement('style');
            style.textContent = `
                body {{
                    border: 5px solid {self.worker_colors[self.worker_id]} !important;
                    box-sizing: border-box;
                }}
                body::before {{
                    content: 'Worker {self.worker_id + 1}';
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: {self.worker_colors[self.worker_id]};
                    color: white;
                    padding: 5px 10px;
                    border-radius: 5px;
                    z-index: 9999;
                    font-family: monospace;
                    font-weight: bold;
                }}
            `;
            document.head.appendChild(style);
        """)
        
        logging.getLogger().info(f"🚀 Worker {self.worker_id} browser initialized with keywords {'ENABLED' if self.enable_keywords else 'DISABLED'}", extra={'worker_id': self.worker_id})


async def run_worker(worker_id: int, enable_keywords: bool = True):
    """Run a single worker"""
    scraper = FourWindowScraperWithKeywords(
        worker_id=worker_id,
        mode='continuous',
        batch_size=100,
        delay_seconds=0,  # No delay for speed
        headless=False,
        enable_keywords=enable_keywords
    )
    
    try:
        await scraper.run()
    except Exception as e:
        logging.error(f"Worker {worker_id} crashed: {e}", extra={'worker_id': worker_id})
    finally:
        await scraper.cleanup()


async def main():
    """Run 4 parallel workers with keyword search"""
    import argparse
    parser = argparse.ArgumentParser(description='Four window unified scraper with keyword search')
    parser.add_argument('--no-keywords', action='store_true',
                        help='Disable keyword search fallback')
    
    args = parser.parse_args()
    enable_keywords = not args.no_keywords
    
    print(f"🚀 Starting 4-window unified scraper with keyword search {'ENABLED' if enable_keywords else 'DISABLED'}...")
    print("📊 Workers will be positioned in 4 quadrants")
    print("🔄 Running in continuous mode")
    print("⚡ No delays between jobs for maximum speed")
    print("\nPress Ctrl+C to stop all workers\n")
    
    # Create tasks for all 4 workers
    tasks = [
        asyncio.create_task(run_worker(i, enable_keywords)) 
        for i in range(4)
    ]
    
    try:
        # Run all workers
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n⛔ Stopping all workers...")
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(main())