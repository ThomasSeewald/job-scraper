#!/usr/bin/env python3
"""
Enhanced Unified Scraper with Google Domains Integration
Shows how to integrate the Google Domains Service with existing scrapers
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime

# Import the original UnifiedScraper
from unified_scraper import UnifiedScraper as BaseUnifiedScraper
from google_domains_client import GoogleDomainsClient

logger = logging.getLogger(__name__)


class UnifiedScraperWithGoogle(BaseUnifiedScraper):
    """Enhanced scraper that checks Google domains before Arbeitsagentur"""
    
    def __init__(self, worker_id: int = 0, mode: str = 'batch', 
                 batch_size: int = 50, delay_seconds: int = 10, 
                 headless: bool = False):
        super().__init__(worker_id, mode, batch_size, delay_seconds, headless)
        
        # Initialize Google Domains client
        self.google_client = GoogleDomainsClient(
            base_url="http://localhost:5000",
            source_system="job_scraper"
        )
        
        # Stats for Google cache hits
        self.google_cache_hits = 0
        self.google_new_searches = 0
    
    def get_job_postal_code(self, refnr: str) -> Optional[str]:
        """Get postal code for a job reference number"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT arbeitsort_plz 
                FROM job_scrp_arbeitsagentur_jobs_v2 
                WHERE refnr = %s
            """, (refnr,))
            
            result = cursor.fetchone()
            return result[0] if result else None
            
        except Exception as e:
            logger.error(f"Error getting postal code: {e}")
            return None
        finally:
            if conn:
                cursor.close()
                conn.close()
    
    async def process_job(self, employer_name: str, refnr: str, job_title: str) -> Dict[str, Any]:
        """Enhanced process_job that checks Google domains first"""
        
        # Get job postal code
        postal_code = self.get_job_postal_code(refnr)
        
        # First, try Google Domains Service
        logger.info("🔍 Checking Google domains cache...")
        try:
            google_result = self.google_client.search_domain(
                company_name=employer_name,
                postal_code=postal_code
            )
            
            if google_result.get('status') == 'cached':
                # Found in cache with high confidence
                self.google_cache_hits += 1
                logger.info(f"✅ Google cache hit! Domain: {google_result.get('domain')}")
                logger.info(f"   Similarity: {google_result.get('similarity_score', 0):.2f}")
                
                # Extract emails from the domain if not already in cache
                emails = google_result.get('emails', [])
                if google_result.get('domain') and not emails:
                    logger.info("📧 Extracting emails from domain...")
                    email_result = self.google_client.extract_emails(
                        google_result['domain'],
                        ['impressum', 'kontakt', 'karriere', 'jobs']
                    )
                    emails = email_result.get('emails', {}).get('all', [])
                
                return {
                    'success': True,
                    'has_emails': bool(emails),
                    'emails': emails,
                    'primary_domain': google_result.get('domain'),
                    'source': 'google_cache',
                    'similarity_score': google_result.get('similarity_score'),
                    'email_count': len(emails)
                }
            
            elif google_result.get('status') == 'new_search':
                # New Google search performed
                self.google_new_searches += 1
                if google_result.get('domain') and google_result.get('is_verified'):
                    logger.info(f"🆕 New Google search found domain: {google_result['domain']}")
                    
                    # Extract emails
                    email_result = self.google_client.extract_emails(
                        google_result['domain'],
                        ['impressum', 'kontakt', 'karriere', 'jobs']
                    )
                    emails = email_result.get('emails', {}).get('all', [])
                    
                    if emails:
                        return {
                            'success': True,
                            'has_emails': True,
                            'emails': emails,
                            'primary_domain': google_result['domain'],
                            'source': 'google_new',
                            'email_count': len(emails)
                        }
        
        except Exception as e:
            logger.warning(f"Google domains error (continuing with Arbeitsagentur): {e}")
        
        # Fall back to Arbeitsagentur scraping
        logger.info("↩️ Falling back to Arbeitsagentur scraping...")
        result = await super().process_job(employer_name, refnr, job_title)
        
        # If we found a domain via external URL, verify it with Google
        if result.get('success') and result.get('primary_domain'):
            try:
                verification = self.google_client.verify_domain(
                    result['primary_domain'],
                    employer_name,
                    postal_code=postal_code
                )
                if verification.get('verified'):
                    logger.info(f"✓ Domain verified: {result['primary_domain']}")
            except Exception as e:
                logger.warning(f"Domain verification error: {e}")
        
        return result
    
    async def run(self):
        """Enhanced run method with Google stats"""
        await super().run()
        
        # Add Google stats to summary
        if self.processed_count > 0:
            logger.info(f"\n📊 Google Domains Stats:")
            logger.info(f"   Cache hits: {self.google_cache_hits}")
            logger.info(f"   New searches: {self.google_new_searches}")
            logger.info(f"   Cache hit rate: {self.google_cache_hits/self.processed_count*100:.1f}%")
    
    async def cleanup(self):
        """Enhanced cleanup"""
        # Close Google client
        self.google_client.close()
        
        # Call parent cleanup
        await super().cleanup()


async def main():
    """Main entry point for enhanced scraper"""
    import argparse
    parser = argparse.ArgumentParser(description='Enhanced scraper with Google domains')
    parser.add_argument('--worker-id', type=int, default=0, help='Worker ID')
    parser.add_argument('--mode', choices=['batch', 'continuous'], default='batch')
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--delay', type=int, default=0)
    parser.add_argument('--headless', action='store_true')
    
    args = parser.parse_args()
    
    scraper = UnifiedScraperWithGoogle(
        worker_id=args.worker_id,
        mode=args.mode,
        batch_size=args.batch_size,
        delay_seconds=args.delay,
        headless=args.headless
    )
    
    try:
        await scraper.run()
    finally:
        await scraper.cleanup()


if __name__ == '__main__':
    asyncio.run(main())