"""Keyword-based email searcher for finding emails on impressum, kontakt, karriere pages"""

import re
import logging
from typing import List, Dict, Set, Optional, Tuple
from urllib.parse import urljoin, urlparse
from playwright.async_api import Page
import asyncio

logger = logging.getLogger(__name__)

class KeywordSearcher:
    """Search for emails on keyword-specific pages (impressum, kontakt, etc.)"""
    
    def __init__(self, email_extractor=None):
        # German keyword mappings with English equivalents
        self.KEYWORD_MAPPINGS = {
            'impressum': ['impressum', 'imprint', 'legal-notice', 'legal'],
            'kontakt': ['kontakt', 'contact', 'contact-us', 'kontaktieren'],
            'karriere': ['karriere', 'career', 'careers', 'jobs', 'stellenangebote'],
            'jobs': ['jobs', 'stellenangebote', 'stellen', 'karriere', 'career', 'careers']
        }
        
        # Reuse email extractor if provided, otherwise create basic pattern
        self.email_extractor = email_extractor
        if not self.email_extractor:
            self.email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        
        # Settings
        self.max_links_per_keyword = 3
        self.page_load_timeout = 10000  # 10 seconds
        
    async def search_domain_for_emails(self, page: Page, domain: str) -> Dict[str, any]:
        """Main entry point: search a domain for emails using keyword pages"""
        results = {
            'emails_by_keyword': {},
            'all_emails': [],
            'unique_emails': [],
            'email_count': 0,
            'keywords_found': [],
            'success': False,
            'error': None
        }
        
        try:
            # Ensure we have a proper URL
            base_url = domain if domain.startswith('http') else f'https://{domain}'
            
            # Find keyword links on the domain
            keyword_links = await self.find_keyword_links(page, base_url)
            
            if not keyword_links:
                logger.info(f"No keyword links found on {domain}")
                return results
                
            # Scrape emails from keyword pages
            emails_by_keyword = await self.scrape_emails_from_keyword_pages(page, keyword_links, domain)
            
            # Aggregate results
            all_emails = []
            for keyword, emails in emails_by_keyword.items():
                if emails:
                    results['keywords_found'].append(keyword)
                    results['emails_by_keyword'][keyword] = emails
                    all_emails.extend(emails)
            
            # Remove duplicates
            results['unique_emails'] = list(set(all_emails))
            results['all_emails'] = all_emails
            results['email_count'] = len(results['unique_emails'])
            results['success'] = len(results['unique_emails']) > 0
            
            logger.info(f"Keyword search on {domain}: found {results['email_count']} unique emails from {results['keywords_found']}")
            
        except Exception as e:
            logger.error(f"Error in keyword search for {domain}: {e}")
            results['error'] = str(e)
            
        return results
        
    async def find_keyword_links(self, page: Page, base_url: str) -> Dict[str, List[Dict]]:
        """Find all links on a page that match our keywords"""
        keyword_links = {}
        
        try:
            logger.info(f"Visiting {base_url} to find keyword links...")
            
            # Navigate to the base URL
            await page.goto(base_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
            await page.wait_for_timeout(2000)  # Brief wait for dynamic content
            
            # Extract all links from the page
            links = await page.evaluate('''() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                return anchors.map(a => ({
                    href: a.href,
                    text: (a.textContent || '').toLowerCase().trim()
                })).filter(link => link.href && link.href.startsWith('http'));
            }''')
            
            # Categorize links by keywords
            for german_keyword, variants in self.KEYWORD_MAPPINGS.items():
                matching_links = []
                
                for link in links:
                    url_lower = link['href'].lower()
                    text_lower = link['text'].lower()
                    
                    # Check if any variant matches in URL or text
                    if any(variant in url_lower or variant in text_lower for variant in variants):
                        # Avoid duplicates
                        if not any(ml['href'] == link['href'] for ml in matching_links):
                            matching_links.append(link)
                
                if matching_links:
                    keyword_links[german_keyword] = matching_links
                    logger.info(f"Found {len(matching_links)} {german_keyword} links")
                    
        except Exception as e:
            logger.warning(f"Error finding keyword links on {base_url}: {e}")
            
        return keyword_links
        
    async def scrape_emails_from_keyword_pages(self, page: Page, keyword_links: Dict[str, List[Dict]], domain: str) -> Dict[str, List[str]]:
        """Scrape emails from the found keyword pages"""
        emails_by_keyword = {}
        
        for keyword, links in keyword_links.items():
            emails = set()
            
            # Process up to max_links_per_keyword links
            for link in links[:self.max_links_per_keyword]:
                try:
                    logger.info(f"Scraping {keyword} page: {link['href']}")
                    
                    # Navigate to the keyword page
                    await page.goto(link['href'], wait_until='domcontentloaded', timeout=self.page_load_timeout)
                    await page.wait_for_timeout(1000)
                    
                    # Extract page content
                    page_content = await page.content()
                    
                    # Extract emails
                    if self.email_extractor:
                        # Use the provided email extractor for consistency
                        extraction_result = self.email_extractor.extract_from_page_content(page_content)
                        found_emails = extraction_result.get('emails', [])
                    else:
                        # Fallback to basic regex
                        page_text = await page.evaluate('() => document.body.textContent || ""')
                        found_emails = self.email_pattern.findall(page_text)
                        
                        # Basic filtering
                        found_emails = [
                            email.lower() for email in found_emails
                            if not any(exclude in email.lower() for exclude in [
                                'example.', 'test@', 'noreply@', 'no-reply@'
                            ])
                        ]
                    
                    # Add to set
                    for email in found_emails:
                        emails.add(email)
                        
                except Exception as e:
                    logger.warning(f"Error scraping {link['href']}: {e}")
                    
            if emails:
                emails_by_keyword[keyword] = list(emails)
                logger.info(f"Found {len(emails)} emails on {keyword} pages for {domain}")
                
        return emails_by_keyword
        
    def format_keyword_notes(self, keyword_results: Dict[str, any]) -> str:
        """Format keyword search results for database notes"""
        if not keyword_results.get('success'):
            return "Keyword search attempted - no emails found"
            
        keywords = keyword_results.get('keywords_found', [])
        email_count = keyword_results.get('email_count', 0)
        
        if keywords:
            keyword_summary = ', '.join(keywords)
            notes = f"Keyword search found {email_count} emails in: {keyword_summary}"
            
            # Add sample emails if available
            unique_emails = keyword_results.get('unique_emails', [])
            if unique_emails:
                sample_emails = unique_emails[:5]
                email_list = ', '.join(sample_emails)
                if len(unique_emails) > 5:
                    email_list += f" (and {len(unique_emails) - 5} more)"
                notes += f". Emails: {email_list}"
                
            return notes
        else:
            return "Keyword search attempted - no keyword pages found"