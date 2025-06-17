#!/usr/bin/env python3
"""
Domains Retry Scraper - Retry failed domains from our_domains table
Uses modern Playwright to retry domains that failed with old Scrapy-based scrapers
"""

import asyncio
import logging
import json
import argparse
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from base_scraper import BaseScraper
from email_extractor import EmailExtractor
import config

class DomainsRetryScraper(BaseScraper):
    def __init__(self, worker_id: int = 0, headless: bool = True):
        super().__init__(worker_id, headless)
        self.email_extractor = EmailExtractor()
        
        # Configure logging - create logs directory if it doesn't exist
        import os
        os.makedirs('logs', exist_ok=True)
        
        logging.basicConfig(
            level=logging.INFO,
            format=f'[Retry-{worker_id}] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('logs/domains_retry.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
    async def get_retry_batch(self, batch_size: int = 25) -> List[Dict]:
        """Get next batch of domains to retry"""
        query = """
            SELECT 
                queue_id, domain_id, domain_url, retry_category, 
                original_error, retry_attempts
            FROM get_next_retry_batch(%s)
        """
        
        try:
            self.db_cursor.execute(query, (batch_size,))
            rows = self.db_cursor.fetchall()
            self.db_conn.commit()  # Commit to save the status updates from function
            return rows
        except Exception as e:
            self.db_conn.rollback()  # Rollback on error
            self.logger.error(f"Error getting retry batch: {e}")
            return []
    
    async def update_retry_result(self, queue_id: int, success: bool, 
                                emails: Optional[str] = None, error: Optional[str] = None):
        """Update retry result in database"""
        if success:
            status = 'completed'
            next_retry = None
        else:
            status = 'queued'  # Will retry again later
            # Exponential backoff: wait longer each time
            retry_attempts = await self.get_retry_attempts(queue_id)
            wait_hours = min(24, 2 ** retry_attempts)  # Max 24 hours
            next_retry = datetime.now() + timedelta(hours=wait_hours)
        
        update_query = """
            UPDATE our_domains_retry_queue 
            SET status = %s,
                retry_success = %s,
                new_emails = %s,
                new_error = %s,
                next_retry_at = %s,
                completed_at = CASE WHEN %s THEN CURRENT_TIMESTAMP ELSE NULL END
            WHERE id = %s
        """
        
        self.db_cursor.execute(update_query, (status, success, emails, error, next_retry, success, queue_id))
        self.db_conn.commit()
    
    async def get_retry_attempts(self, queue_id: int) -> int:
        """Get current retry attempts for a queue item"""
        query = "SELECT retry_attempts FROM our_domains_retry_queue WHERE id = %s"
        self.db_cursor.execute(query, (queue_id,))
        result = self.db_cursor.fetchone()
        return result['retry_attempts'] if result else 0
    
    async def update_original_domain(self, domain_id: int, emails: str, success: bool = True):
        """Update the original our_domains record with new results"""
        update_query = """
            UPDATE our_domains 
            SET emails_found = %s,
                best_email = %s,
                error_message = CASE WHEN %s THEN NULL ELSE error_message END,
                domain_scaned_for_emails = true,
                write_date = CURRENT_TIMESTAMP
            WHERE id = %s
        """
        
        self.db_cursor.execute(update_query, (success, emails, success, domain_id))
        self.db_conn.commit()
    
    async def scrape_domain_for_emails(self, domain_url: str, retry_category: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Scrape a domain for emails using modern techniques
        Returns: (success, emails, error_message)
        """
        try:
            # Clean and prepare URL
            if not domain_url.startswith(('http://', 'https://')):
                domain_url = f"https://{domain_url}"
            
            self.logger.info(f"🔄 Retrying domain: {domain_url} (category: {retry_category})")
            
            # Navigate to domain
            await self.page.goto(domain_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(2)
            
            # Check for common error indicators
            if await self.page.locator('text="DNS_PROBE_FINISHED_NXDOMAIN"').count() > 0:
                return False, None, "Domain does not exist (DNS error)"
            
            if await self.page.locator('text="This site can\'t be reached"').count() > 0:
                return False, None, "Site unreachable"
            
            # Extract emails from main page first
            main_emails = await self.email_extractor.extract_emails_from_page(self.page)
            
            # For link_detection_retry category, try to find contact/impressum links
            contact_emails = []
            impressum_emails = []
            
            if retry_category == 'link_detection_retry' or len(main_emails) == 0:
                # Look for contact page links
                contact_links = await self.find_contact_links()
                
                for link_text, link_url in contact_links:
                    try:
                        if any(word in link_text.lower() for word in ['kontakt', 'contact', 'ansprechpartner']):
                            await self.page.goto(link_url, wait_until='domcontentloaded', timeout=15000)
                            page_emails = await self.email_extractor.extract_emails_from_page(self.page)
                            contact_emails.extend(page_emails)
                            
                        elif any(word in link_text.lower() for word in ['impressum', 'imprint']):
                            await self.page.goto(link_url, wait_until='domcontentloaded', timeout=15000)
                            page_emails = await self.email_extractor.extract_emails_from_page(self.page)
                            impressum_emails.extend(page_emails)
                            
                    except Exception as e:
                        self.logger.debug(f"Error accessing {link_url}: {e}")
                        continue
            
            # Combine all found emails
            all_emails = main_emails + contact_emails + impressum_emails
            unique_emails = list(set(all_emails))
            
            if unique_emails:
                emails_str = ','.join(unique_emails)
                self.logger.info(f"✅ Found {len(unique_emails)} emails: {emails_str}")
                return True, emails_str, None
            else:
                return False, None, "No emails found on domain"
                
        except Exception as e:
            error_msg = f"Scraping error: {str(e)}"
            self.logger.error(f"❌ {error_msg}")
            return False, None, error_msg
    
    async def find_contact_links(self) -> List[Tuple[str, str]]:
        """Find contact and impressum links on the page"""
        contact_links = []
        
        # Common German and English contact keywords
        keywords = [
            'kontakt', 'contact', 'ansprechpartner', 'impressum', 'imprint',
            'über uns', 'about us', 'team', 'firma', 'company'
        ]
        
        # Find all links
        links = await self.page.locator('a').all()
        
        for link in links[:20]:  # Limit to first 20 links for performance
            try:
                text = await link.text_content()
                href = await link.get_attribute('href')
                
                if not text or not href:
                    continue
                    
                text_lower = text.lower().strip()
                
                # Check if link text contains contact keywords
                if any(keyword in text_lower for keyword in keywords):
                    # Convert relative URLs to absolute
                    if href.startswith('/'):
                        current_url = self.page.url
                        base_url = f"{current_url.split('/')[0]}//{current_url.split('/')[2]}"
                        href = base_url + href
                    elif not href.startswith(('http://', 'https://')):
                        continue
                        
                    contact_links.append((text, href))
                    
            except Exception:
                continue
                
        return contact_links
    
    async def process_batch(self, batch_size: int = 25) -> Dict[str, int]:
        """Process a batch of retry domains"""
        stats = {
            'processed': 0,
            'successful': 0,
            'failed': 0,
            'emails_found': 0
        }
        
        # Get batch of domains to retry
        domains = await self.get_retry_batch(batch_size)
        
        if not domains:
            self.logger.info("No domains available for retry")
            return stats
        
        self.logger.info(f"🚀 Processing {len(domains)} retry domains")
        
        for domain in domains:
            stats['processed'] += 1
            
            queue_id = domain['queue_id']
            domain_id = domain['domain_id']
            domain_url = domain['domain_url']
            retry_category = domain['retry_category']
            
            try:
                success, emails, error = await self.scrape_domain_for_emails(domain_url, retry_category)
                
                if success and emails:
                    stats['successful'] += 1
                    stats['emails_found'] += len(emails.split(','))
                    
                    # Update both retry queue and original domain record
                    await self.update_retry_result(queue_id, True, emails)
                    await self.update_original_domain(domain_id, emails, True)
                    
                else:
                    stats['failed'] += 1
                    await self.update_retry_result(queue_id, False, error=error)
                    
            except Exception as e:
                stats['failed'] += 1
                error_msg = f"Processing error: {str(e)}"
                self.logger.error(f"❌ Error processing {domain_url}: {error_msg}")
                await self.update_retry_result(queue_id, False, error=error_msg)
            
            # Small delay between domains
            await asyncio.sleep(1.5)
        
        return stats
    
    async def run_continuous(self, batch_size: int = 25, delay_minutes: int = 30):
        """Run continuous retry processing"""
        self.logger.info(f"🔄 Starting continuous retry processing (batch_size={batch_size}, delay={delay_minutes}min)")
        
        while True:
            try:
                stats = await self.process_batch(batch_size)
                
                self.logger.info(f"📊 Batch complete: {stats['processed']} processed, "
                               f"{stats['successful']} successful, {stats['emails_found']} emails found")
                
                if stats['processed'] == 0:
                    self.logger.info(f"😴 No domains to process, sleeping for {delay_minutes} minutes")
                    await asyncio.sleep(delay_minutes * 60)
                else:
                    # Short delay between batches when processing
                    await asyncio.sleep(60)
                    
            except KeyboardInterrupt:
                self.logger.info("🛑 Stopping retry scraper")
                break
            except Exception as e:
                self.logger.error(f"❌ Error in continuous processing: {e}")
                await asyncio.sleep(300)  # 5 minute delay on error

async def main():
    parser = argparse.ArgumentParser(description='Retry failed domains from our_domains table')
    parser.add_argument('--batch-size', type=int, default=25, help='Domains per batch')
    parser.add_argument('--mode', choices=['batch', 'continuous'], default='batch', help='Processing mode')
    parser.add_argument('--delay', type=int, default=30, help='Minutes between batches in continuous mode')
    parser.add_argument('--worker-id', type=int, default=0, help='Worker ID')
    parser.add_argument('--headless', action='store_true', help='Run in headless mode')
    
    args = parser.parse_args()
    
    scraper = DomainsRetryScraper(worker_id=args.worker_id, headless=args.headless)
    
    try:
        await scraper.initialize()
        
        if args.mode == 'continuous':
            await scraper.run_continuous(args.batch_size, args.delay)
        else:
            stats = await scraper.process_batch(args.batch_size)
            print(f"\n📊 Final Stats:")
            print(f"  Processed: {stats['processed']}")
            print(f"  Successful: {stats['successful']}")
            print(f"  Failed: {stats['failed']}")
            print(f"  Emails found: {stats['emails_found']}")
            
    finally:
        await scraper.cleanup()

if __name__ == "__main__":
    asyncio.run(main())