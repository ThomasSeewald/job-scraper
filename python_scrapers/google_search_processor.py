#!/usr/bin/env python3
"""
Google Search Processor - Processes the queue of employers needing Google searches
Respects daily budget limit of $100
"""

import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, List, Optional

from google_domain_searcher import GoogleDomainSearcher
from keyword_searcher import KeywordSearcher
from data_providers import GoogleSearchQueueProvider, DomainCacheProvider

logger = logging.getLogger(__name__)


class GoogleSearchProcessor:
    """Processes queued employers with Google Custom Search API"""
    
    def __init__(self, batch_size: int = 10):
        self.batch_size = batch_size
        self.queue_provider = GoogleSearchQueueProvider()
        self.domain_cache = DomainCacheProvider()
        self.google_searcher = GoogleDomainSearcher()
        self.keyword_searcher = KeywordSearcher()
        
        # Statistics
        self.searches_performed = 0
        self.domains_found = 0
        self.emails_found = 0
        self.cost_incurred = 0.0
        
    async def process_queue(self):
        """Process employers in the Google search queue"""
        logger.info("🔍 Starting Google Search Processor")
        
        while True:
            # Check daily budget
            usage = self.queue_provider.get_todays_usage()
            if not usage['can_continue']:
                logger.warning(f"Daily budget reached: ${usage['cost']:.2f}/$100.00")
                break
            
            logger.info(f"Current usage: ${usage['cost']:.2f}/$100.00 ({usage['queries']} queries)")
            
            # Get next batch
            batch = self.queue_provider.get_next_batch(self.batch_size)
            if not batch:
                logger.info("No more items in queue")
                break
            
            logger.info(f"Processing batch of {len(batch)} employers")
            
            for item in batch:
                await self.process_employer(item)
                
                # Small delay between searches
                await asyncio.sleep(0.5)
        
        # Print summary
        self._print_summary()
    
    async def process_employer(self, queue_item: Dict):
        """Process a single employer from the queue"""
        employer_name = queue_item['employer_name']
        postal_code = queue_item['postal_code']
        queue_id = queue_item['id']
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Searching: {employer_name} ({postal_code})")
        
        try:
            # Perform Google search
            results = await self.google_searcher.search_employer(
                company_name=employer_name,
                postal_code=postal_code,
                num_results=5
            )
            
            self.searches_performed += 1
            self.cost_incurred += self.queue_provider.cost_per_1000 / 1000
            
            if not results:
                logger.warning("No search results found")
                self.queue_provider.mark_processed(queue_id, False, "No results")
                return
            
            # Get best matches
            best_matches = await self.google_searcher.get_best_matches(
                results, employer_name, postal_code
            )
            
            # Process top match
            if best_matches:
                top_match = best_matches[0]
                domain = top_match.get('domain')
                
                if domain and not top_match.get('is_portal'):
                    logger.info(f"✓ Found domain: {domain}")
                    self.domains_found += 1
                    
                    # Extract emails from domain
                    emails = await self._extract_emails_from_domain(domain)
                    
                    if emails:
                        logger.info(f"📧 Found {len(emails)} emails: {emails}")
                        self.emails_found += len(emails)
                    else:
                        logger.info("No emails found on domain")
                    
                    # Save to cache
                    self.domain_cache.save_domain_info(
                        employer_name, postal_code, domain, emails, 'google_api'
                    )
                    
                    # Save to our_google_search table
                    self._save_google_search_record(
                        employer_name, postal_code, domain, results
                    )
                    
                    self.queue_provider.mark_processed(queue_id, True)
                else:
                    logger.info("Top result is a portal/directory, skipping")
                    self.queue_provider.mark_processed(queue_id, False, "Portal/directory")
            else:
                logger.info("No relevant matches found")
                self.queue_provider.mark_processed(queue_id, False, "No relevant matches")
                
        except Exception as e:
            logger.error(f"Error processing employer: {e}")
            self.queue_provider.mark_processed(queue_id, False, str(e))
    
    async def _extract_emails_from_domain(self, domain: str) -> List[str]:
        """Extract emails from domain using keyword searcher"""
        try:
            # Try impressum first (required in Germany)
            impressum_result = await self.keyword_searcher.search_keyword_on_domain(
                domain, 'impressum'
            )
            
            if impressum_result.get('emails'):
                return impressum_result['emails']
            
            # Try contact page
            contact_result = await self.keyword_searcher.search_keyword_on_domain(
                domain, 'kontakt'
            )
            
            if contact_result.get('emails'):
                return contact_result['emails']
            
            # Try jobs/karriere page
            for keyword in ['karriere', 'jobs', 'career']:
                result = await self.keyword_searcher.search_keyword_on_domain(
                    domain, keyword
                )
                if result.get('emails'):
                    return result['emails']
            
            return []
            
        except Exception as e:
            logger.error(f"Error extracting emails from {domain}: {e}")
            return []
    
    def _save_google_search_record(self, employer_name: str, postal_code: str, 
                                  domain: str, results: List[Dict]):
        """Save Google search record to database"""
        conn = None
        try:
            conn = self.queue_provider.get_db_connection()
            cursor = conn.cursor()
            
            # Create table if not exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS our_google_search (
                    id SERIAL PRIMARY KEY,
                    query VARCHAR(500),
                    employer_name VARCHAR(255),
                    postal_code VARCHAR(10),
                    domain_found VARCHAR(255),
                    results_count INTEGER,
                    results_json TEXT,
                    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Insert record
            cursor.execute("""
                INSERT INTO our_google_search 
                (query, employer_name, postal_code, domain_found, results_count, results_json)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                f"{employer_name} {postal_code}",
                employer_name,
                postal_code,
                domain,
                len(results),
                json.dumps(results, ensure_ascii=False)
            ))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error saving Google search record: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                conn.close()
    
    def _print_summary(self):
        """Print processing summary"""
        logger.info(f"""
        
        ✅ Google Search Processing Complete
        =====================================
        Searches performed: {self.searches_performed}
        Domains found: {self.domains_found}
        Emails found: {self.emails_found}
        Cost incurred: ${self.cost_incurred:.2f}
        
        Success rate: {self.domains_found / self.searches_performed * 100:.1f}% (domains)
        Email rate: {self.emails_found / self.searches_performed:.1f} emails/search
        """)


async def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Google Search Queue Processor')
    parser.add_argument('--batch-size', type=int, default=10,
                       help='Number of employers to process per batch')
    parser.add_argument('--test', action='store_true',
                       help='Test mode - process only 5 employers')
    
    args = parser.parse_args()
    
    processor = GoogleSearchProcessor(
        batch_size=args.batch_size if not args.test else 5
    )
    
    await processor.process_queue()


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(message)s'
    )
    
    asyncio.run(main())