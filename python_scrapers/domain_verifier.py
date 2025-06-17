#!/usr/bin/env python3
"""
Domain Verifier
Verifies if a domain belongs to a specific employer by checking impressum
"""

import aiohttp
import asyncio
import logging
import re
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup

from address_extractor import AddressExtractor
from company_name_matcher import CompanyNameMatcher

logger = logging.getLogger(__name__)


class DomainVerifier:
    """Verify domains belong to specific employers"""
    
    # Common impressum URL patterns
    IMPRESSUM_PATHS = [
        '/impressum',
        '/impressum.html',
        '/impressum.htm',
        '/impressum.php',
        '/impressum.aspx',
        '/legal/impressum',
        '/legal/imprint',
        '/imprint',
        '/info/impressum',
        '/de/impressum',
        '/footer/impressum',
        '/service/impressum',
        '/kontakt/impressum',
        '/about/impressum',
        '/unternehmen/impressum'
    ]
    
    # Email patterns
    EMAIL_PATTERN = re.compile(
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        re.IGNORECASE
    )
    
    # Email obfuscation patterns
    OBFUSCATED_PATTERNS = [
        (r'\[at\]', '@'),
        (r'\(at\)', '@'),
        (r'\[dot\]', '.'),
        (r'\(dot\)', '.'),
        (r'\[punkt\]', '.'),
        (r'\(punkt\)', '.'),
        (r' at ', '@'),
        (r' dot ', '.'),
        (r' punkt ', '.'),
    ]
    
    def __init__(self):
        """Initialize verifier"""
        self.address_extractor = AddressExtractor()
        self.name_matcher = CompanyNameMatcher()
        self.session = None
    
    async def get_session(self):
        """Get or create aiohttp session"""
        if not self.session:
            timeout = aiohttp.ClientTimeout(total=30)
            self.session = aiohttp.ClientSession(timeout=timeout)
        return self.session
    
    async def close_session(self):
        """Close aiohttp session"""
        if self.session:
            await self.session.close()
            self.session = None
    
    def normalize_email(self, text: str) -> str:
        """
        Normalize obfuscated email addresses
        
        Args:
            text: Text possibly containing obfuscated emails
            
        Returns:
            Text with normalized emails
        """
        normalized = text
        for pattern, replacement in self.OBFUSCATED_PATTERNS:
            normalized = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)
        return normalized
    
    def extract_emails(self, text: str) -> List[str]:
        """
        Extract email addresses from text
        
        Args:
            text: Text to search for emails
            
        Returns:
            List of unique email addresses
        """
        # First normalize obfuscated emails
        normalized_text = self.normalize_email(text)
        
        # Find all email matches
        emails = self.EMAIL_PATTERN.findall(normalized_text)
        
        # Clean and deduplicate
        unique_emails = []
        seen = set()
        
        for email in emails:
            email_lower = email.lower().strip()
            
            # Skip common non-emails
            if any(skip in email_lower for skip in ['example.com', 'domain.com', 'email.com']):
                continue
            
            # Skip images and files
            if any(email_lower.endswith(ext) for ext in ['.png', '.jpg', '.gif', '.pdf']):
                continue
            
            if email_lower not in seen:
                seen.add(email_lower)
                unique_emails.append(email)
        
        return unique_emails
    
    async def find_impressum_url(self, domain: str) -> Optional[str]:
        """
        Find impressum page URL for domain
        
        Args:
            domain: Domain to check
            
        Returns:
            Impressum URL or None
        """
        base_url = f"https://{domain}" if not domain.startswith('http') else domain
        
        # First, try to fetch homepage and look for impressum link
        try:
            session = await self.get_session()
            async with session.get(base_url) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Look for impressum links
                    for link in soup.find_all('a', href=True):
                        href = link['href'].lower()
                        text = link.get_text().lower()
                        
                        if 'impressum' in href or 'imprint' in href or 'impressum' in text:
                            impressum_url = urljoin(base_url, link['href'])
                            logger.info(f"Found impressum link: {impressum_url}")
                            return impressum_url
        except Exception as e:
            logger.warning(f"Error fetching homepage {base_url}: {e}")
        
        # Try common impressum paths
        for path in self.IMPRESSUM_PATHS:
            impressum_url = urljoin(base_url, path)
            try:
                session = await self.get_session()
                async with session.get(impressum_url) as response:
                    if response.status == 200:
                        # Check if it's actually an impressum page
                        html = await response.text()
                        if any(word in html.lower() for word in ['impressum', 'imprint', 'handelsregister']):
                            logger.info(f"Found impressum at: {impressum_url}")
                            return impressum_url
            except Exception as e:
                logger.debug(f"Path {path} not found: {e}")
                continue
        
        return None
    
    async def fetch_page_content(self, url: str) -> Optional[str]:
        """
        Fetch and return page content
        
        Args:
            url: URL to fetch
            
        Returns:
            Page content or None
        """
        try:
            session = await self.get_session()
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    return await response.text()
                else:
                    logger.warning(f"Failed to fetch {url}: Status {response.status}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None
    
    async def verify_domain(self, domain: str, company_name: str,
                          street: str = None, postal_code: str = None) -> Dict:
        """
        Verify if domain belongs to the company
        
        Args:
            domain: Domain to verify
            company_name: Expected company name
            street: Expected street address
            postal_code: Expected postal code
            
        Returns:
            Verification result with score and details
        """
        logger.info(f"Verifying {domain} for {company_name}")
        
        # Find impressum page
        impressum_url = await self.find_impressum_url(domain)
        if not impressum_url:
            return {
                'verified': False,
                'score': 0.0,
                'reason': 'No impressum page found'
            }
        
        # Fetch impressum content
        content = await self.fetch_page_content(impressum_url)
        if not content:
            return {
                'verified': False,
                'score': 0.0,
                'reason': 'Could not fetch impressum content'
            }
        
        # Clean content
        text = self.address_extractor.clean_html_text(content)
        
        # Check company name similarity
        normalized_content = self.name_matcher.normalize_company_name(text)
        normalized_company = self.name_matcher.normalize_company_name(company_name)
        
        # Simple check if company name appears in impressum
        name_found = normalized_company in normalized_content
        
        # Extract base name and check that too
        base_name = self.name_matcher.extract_base_name(company_name)
        base_name_found = base_name and base_name in normalized_content
        
        # Calculate name match score
        name_score = 0.0
        if name_found:
            name_score = 1.0
        elif base_name_found:
            name_score = 0.8
        else:
            # Check word overlap
            company_words = set(normalized_company.split())
            content_words = set(normalized_content.split())
            overlap = len(company_words & content_words)
            if company_words:
                name_score = min(0.7, overlap / len(company_words))
        
        # Extract addresses from impressum
        addresses = self.address_extractor.extract_address_candidates(text)
        
        # Check address match if provided
        address_score = 0.0
        address_details = []
        
        if postal_code and addresses:
            for addr in addresses:
                parsed = self.address_extractor.parse_with_libpostal(addr)
                if parsed.get('postcode') == postal_code:
                    address_score = 1.0
                    address_details.append({
                        'raw': addr,
                        'parsed': parsed,
                        'match': True
                    })
                    break
                elif postal_code in addr:
                    address_score = 0.8
                    address_details.append({
                        'raw': addr,
                        'parsed': parsed,
                        'match': 'partial'
                    })
        
        # Calculate final score
        if postal_code:
            # If postal code provided, weight both name and address
            final_score = (name_score * 0.5) + (address_score * 0.5)
        else:
            # Only name matching
            final_score = name_score
        
        # Determine if verified
        is_verified = final_score >= 0.7
        
        return {
            'verified': is_verified,
            'score': final_score,
            'impressum_url': impressum_url,
            'name_score': name_score,
            'address_score': address_score,
            'addresses_found': address_details,
            'company_name_found': name_found or base_name_found
        }
    
    async def extract_emails_from_domain(self, domain: str, 
                                       pages: List[str] = None) -> Dict[str, List[str]]:
        """
        Extract emails from various pages of a domain
        
        Args:
            domain: Domain to extract emails from
            pages: List of page types to check
            
        Returns:
            Dictionary of emails by page type
        """
        if pages is None:
            pages = ['impressum', 'kontakt', 'karriere', 'jobs']
        
        base_url = f"https://{domain}" if not domain.startswith('http') else domain
        emails_by_page = {}
        all_emails = set()
        
        # Define paths for each page type
        page_paths = {
            'impressum': self.IMPRESSUM_PATHS,
            'kontakt': ['/kontakt', '/contact', '/kontakt.html', '/contact-us', 
                       '/kundenservice', '/support'],
            'karriere': ['/karriere', '/jobs', '/career', '/stellenangebote',
                        '/karriere.html', '/jobs.html'],
            'jobs': ['/jobs', '/stellenangebote', '/offene-stellen', '/vacancies',
                    '/stellenmarkt', '/job-offers']
        }
        
        for page_type in pages:
            if page_type not in page_paths:
                continue
            
            page_emails = []
            
            # Try each path for this page type
            for path in page_paths[page_type]:
                url = urljoin(base_url, path)
                content = await self.fetch_page_content(url)
                
                if content:
                    found_emails = self.extract_emails(content)
                    page_emails.extend(found_emails)
                    
                    if found_emails:
                        logger.info(f"Found {len(found_emails)} emails on {url}")
                        break  # Found emails, no need to try other paths
            
            # Deduplicate page emails
            unique_page_emails = list(set(page_emails))
            if unique_page_emails:
                emails_by_page[f"{page_type}_emails"] = unique_page_emails
                all_emails.update(unique_page_emails)
        
        # Add combined list
        emails_by_page['all'] = list(all_emails)
        
        return emails_by_page


# Example usage
if __name__ == "__main__":
    async def test_verification():
        verifier = DomainVerifier()
        
        # Test verification
        result = await verifier.verify_domain(
            domain="mercedes-benz.de",
            company_name="Mercedes-Benz Vertrieb Deutschland",
            postal_code="70327"
        )
        
        print("Verification result:")
        print(f"  Verified: {result['verified']}")
        print(f"  Score: {result['score']:.2f}")
        print(f"  Name score: {result.get('name_score', 0):.2f}")
        print(f"  Address score: {result.get('address_score', 0):.2f}")
        
        # Test email extraction
        emails = await verifier.extract_emails_from_domain(
            "mercedes-benz.de",
            ['impressum', 'kontakt', 'karriere']
        )
        
        print("\nExtracted emails:")
        for page_type, email_list in emails.items():
            if email_list:
                print(f"  {page_type}: {email_list}")
        
        await verifier.close_session()
    
    # Run test
    asyncio.run(test_verification())