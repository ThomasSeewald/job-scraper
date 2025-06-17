#!/usr/bin/env python3
"""Four window unified scraper with atomic employer claiming"""

import asyncio
import logging
from playwright.async_api import async_playwright

from unified_scraper import UnifiedScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - Worker-%(worker_id)s - %(message)s',
    defaults={'worker_id': 'X'}
)


class FourWindowScraper(UnifiedScraper):
    """Extended unified scraper with window positioning for 4-window display"""
    
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
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
            'locale': 'de-DE',
            'viewport': {'width': 960, 'height': 540}
        }
        
        if self.state_file.exists():
            context_options['storage_state'] = str(self.state_file)
            
        self.context = await self.browser.new_context(**context_options)
        self.page = await self.context.new_page()
        self.page.set_default_timeout(30000)
        
        # Add worker indicator
        worker_color = self.worker_colors[self.worker_id]
        await self.page.add_init_script(f'''
            window.workerInfo = {{
                id: {self.worker_id},
                color: '{worker_color}',
                processed: 0,
                withEmails: 0
            }};
            
            // Create status display on page load
            window.addEventListener('load', () => {{
                const statusDiv = document.createElement('div');
                statusDiv.id = 'worker-status';
                statusDiv.style.position = 'fixed';
                statusDiv.style.top = '0';
                statusDiv.style.left = '0';
                statusDiv.style.right = '0';
                statusDiv.style.padding = '10px';
                statusDiv.style.background = window.workerInfo.color;
                statusDiv.style.color = 'white';
                statusDiv.style.fontSize = '14px';
                statusDiv.style.fontWeight = 'bold';
                statusDiv.style.zIndex = '99999';
                statusDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
                statusDiv.innerHTML = `WORKER ${{window.workerInfo.id}} | Starting...`;
                document.body.appendChild(statusDiv);
            }});
        ''')
        
        logging.getLogger(__name__).info(f"🚀 Worker {self.worker_id} browser initialized in {worker_color} window")
        
    async def process_job(self, employer_name: str, refnr: str, job_title: str) -> dict:
        """Process job with visual feedback"""
        # Update display before processing
        # Escape employer name for JavaScript - handle all special characters
        safe_employer_name = (employer_name[:40]
            .replace('\\', '\\\\')
            .replace("'", "\\'")
            .replace('"', '\\"')
            .replace('\n', ' ')
            .replace('\r', ' ')
            .replace('`', '\\`'))
        
        await self.page.evaluate(f'''
            const statusDiv = document.getElementById('worker-status');
            if (statusDiv) {{
                statusDiv.innerHTML = `
                    <div>WORKER {self.worker_id} | Processing: {safe_employer_name}...</div>
                    <div style="font-size: 12px;">Processed: {self.processed_count} | With Emails: {self.email_count}</div>
                `;
            }}
        ''')
        
        # Process using parent method
        result = await super().process_job(employer_name, refnr, job_title)
        
        # Update display after processing
        if result['success']:
            emails_display = result.get('emails', [])[:2]  # Show first 2 emails
            domain_display = result.get('primary_domain', '')
            status_text = '✅ Success'
            if result.get('has_emails'):
                status_text += f' - 📧 {emails_display}'
                if domain_display:
                    status_text += f' - 🌐 {domain_display}'
            else:
                status_text += ' - 📭 No emails'
        else:
            status_text = f'❌ Failed - {result.get("error", "Unknown")}'
            
        # Escape strings for JavaScript - handle all special characters
        safe_employer_name = (employer_name[:40]
            .replace('\\', '\\\\')
            .replace("'", "\\'")
            .replace('"', '\\"')
            .replace('\n', ' ')
            .replace('\r', ' ')
            .replace('`', '\\`'))
        safe_status_text = (status_text
            .replace('\\', '\\\\')
            .replace("'", "\\'")
            .replace('"', '\\"')
            .replace('\n', ' ')
            .replace('\r', ' ')
            .replace('`', '\\`'))
        
        await self.page.evaluate(f'''
            const statusDiv = document.getElementById('worker-status');
            if (statusDiv) {{
                window.workerInfo.processed++;
                if ({str(result.get('has_emails', False)).lower()}) window.workerInfo.withEmails++;
                
                const successRate = window.workerInfo.processed > 0 
                    ? (window.workerInfo.withEmails / window.workerInfo.processed * 100).toFixed(1)
                    : 0;
                    
                statusDiv.innerHTML = `
                    <div>WORKER {self.worker_id} | {safe_employer_name}... | {safe_status_text}</div>
                    <div style="font-size: 12px;">
                        Processed: ${{window.workerInfo.processed}} | 
                        With Emails: ${{window.workerInfo.withEmails}} | 
                        Success Rate: ${{successRate}}%
                    </div>
                `;
            }}
        ''')
        
        return result


async def run_four_workers():
    """Run 4 workers in split screen"""
    
    print("\n" + "="*60)
    print("🚀 Starting 4-Window Unified Scraper")
    print("🔒 Using atomic employer claiming - no duplicates!")
    print("📊 Each worker processes different employers")
    print("🆕 Newest jobs first, skipping external URLs")
    print("🔄 Continuous operation - press Ctrl+C to stop")
    print("="*60 + "\n")
    
    # Create 4 worker tasks
    workers = []
    for worker_id in range(4):
        worker = FourWindowScraper(
            worker_id=worker_id,
            mode='continuous',  # Run continuously
            delay_seconds=0,    # No delay between jobs
            headless=False      # Always visible
        )
        task = worker.run()
        workers.append(task)
        
    print("⏳ Launching 4 workers...\n")
    
    try:
        # Run all workers concurrently
        await asyncio.gather(*workers)
    except KeyboardInterrupt:
        print("\n\n👋 Stopping all workers...")
        # Clean up workers
        for worker in workers:
            try:
                worker.cancel()
            except:
                pass
        print("✅ All workers stopped")


if __name__ == '__main__':
    try:
        asyncio.run(run_four_workers())
    except KeyboardInterrupt:
        print("\n✅ Gracefully stopped!")