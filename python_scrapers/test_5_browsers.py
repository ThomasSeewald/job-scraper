#!/usr/bin/env python3
"""Test opening 5 separate browser windows"""

import asyncio
from playwright.async_api import async_playwright

async def open_browser_window(worker_id: int):
    """Open a single browser window for a worker"""
    
    print(f"🚀 Starting browser for Worker {worker_id}")
    
    # Each worker gets its own playwright instance
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=False,
        args=['--no-sandbox']
    )
    
    # Create a new page
    page = await browser.new_page()
    
    # Set window position based on worker ID
    await page.set_viewport_size({"width": 800, "height": 600})
    
    # Navigate to a test page
    await page.goto('https://www.arbeitsagentur.de/jobsuche/')
    
    # Add visible worker ID
    await page.evaluate(f'''() => {{
        const div = document.createElement('div');
        div.innerHTML = 'WORKER {worker_id}<br>Browser Window #{worker_id}';
        div.style.position = 'fixed';
        div.style.top = '10px';
        div.style.left = '10px';
        div.style.padding = '20px';
        div.style.background = 'red';
        div.style.color = 'white';
        div.style.fontSize = '24px';
        div.style.fontWeight = 'bold';
        div.style.zIndex = '99999';
        div.style.borderRadius = '10px';
        document.body.appendChild(div);
    }}''')
    
    print(f"✅ Browser {worker_id} is now visible!")
    
    # Keep browser open
    try:
        await asyncio.sleep(86400)  # 24 hours
    except:
        pass
    finally:
        await browser.close()
        await playwright.stop()


async def main():
    """Open 5 browser windows in parallel"""
    
    print("Opening 5 separate browser windows...")
    print("Each should show its worker ID")
    print("Press Ctrl+C to close all\n")
    
    # Create 5 tasks for 5 browser windows
    tasks = []
    for worker_id in range(5):
        task = open_browser_window(worker_id)
        tasks.append(task)
    
    # Run all tasks concurrently
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n👋 Closing all browsers...")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n✅ Test completed!")