#!/usr/bin/env python3
"""
Google Domain Searcher
Searches Google for employer domains using Custom Search API
"""

import aiohttp
import asyncio
import logging
from typing import List, Dict, Optional
from urllib.parse import urlparse, urljoin
import re

logger = logging.getLogger(__name__)


class GoogleDomainSearcher:
    """Search Google for employer domains using Custom Search API"""
    
    def __init__(self, api_key: str = None, search_engine_id: str = None):
        """
        Initialize Google searcher
        
        Args:
            api_key: Google Custom Search API key
            search_engine_id: Custom Search Engine ID
        """
        # Use provided keys or defaults from old Odoo system
        self.api_key = api_key or "AIzaSyBUv0IUn7f4OEfzPF8mqcdHf3X8ubcI7MU"
        self.search_engine_id = search_engine_id or "24f407b14f2344198"
        self.api_url = "https://www.googleapis.com/customsearch/v1"
        
    def build_search_query(self, company_name: str, street: str = None,
                          postal_code: str = None, city: str = None) -> str:
        """
        Build optimized search query for Google
        
        Args:
            company_name: Company name
            street: Street address
            postal_code: Postal code (will be quoted)
            city: City name
            
        Returns:
            Formatted search query
        """
        # Start with company name
        query_parts = [company_name]
        
        # Add street if provided
        if street:
            # Clean street number formatting
            street = re.sub(r'\s+', ' ', street.strip())
            query_parts.append(street)
        
        # Add postal code in quotes (important for German addresses)
        if postal_code:
            query_parts.append(f'"{postal_code}"')
        elif city:
            # If no postal code but city, add city
            query_parts.append(city)
        
        # Join parts
        query = ' '.join(query_parts)
        
        # Clean up extra spaces
        query = re.sub(r'\s+', ' ', query).strip()
        
        logger.info(f"Built search query: {query}")
        return query
    
    def extract_domain(self, url: str) -> Optional[str]:
        """
        Extract domain from URL
        
        Args:
            url: Full URL
            
        Returns:
            Domain name or None
        """
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            
            # Remove www. prefix
            if domain.startswith('www.'):
                domain = domain[4:]
            
            # Validate domain
            if domain and '.' in domain:
                return domain.lower()
            
            return None
        except Exception as e:
            logger.error(f"Error extracting domain from {url}: {e}")
            return None
    
    async def search_employer(self, company_name: str, street: str = None,
                            postal_code: str = None, city: str = None,
                            num_results: int = 10) -> List[Dict]:
        """
        Search Google for employer information
        
        Args:
            company_name: Company name
            street: Street address
            postal_code: Postal code
            city: City name
            num_results: Number of results to return
            
        Returns:
            List of search results
        """
        query = self.build_search_query(company_name, street, postal_code, city)
        
        params = {
            'key': self.api_key,
            'cx': self.search_engine_id,
            'q': query,
            'num': min(num_results, 10),  # Google API limit
            'hl': 'de',  # German language
            'gl': 'de'   # German location
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.api_url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        results = []
                        for item in data.get('items', []):
                            domain = self.extract_domain(item.get('link', ''))
                            
                            result = {
                                'title': item.get('title', ''),
                                'url': item.get('link', ''),
                                'snippet': item.get('snippet', ''),
                                'domain': domain,
                                'display_link': item.get('displayLink', ''),
                                'api_response': item  # Store full response
                            }
                            
                            # Check if it's a known portal/directory
                            if domain:
                                result['is_portal'] = self.is_known_portal(domain)
                            
                            results.append(result)
                        
                        logger.info(f"Found {len(results)} results for {company_name}")
                        return results
                    
                    else:
                        error_data = await response.text()
                        logger.error(f"Google API error {response.status}: {error_data}")
                        return []
                        
        except Exception as e:
            logger.error(f"Error searching Google: {e}")
            return []
    
    def is_known_portal(self, domain: str) -> bool:
        """
        Check if domain is a known job portal or directory
        
        Args:
            domain: Domain to check
            
        Returns:
            True if known portal
        """
        known_portals = [
            'arbeitsagentur.de',
            'stepstone.de',
            'indeed.com',
            'monster.de',
            'xing.com',
            'linkedin.com',
            'kununu.com',
            'glassdoor.de',
            'jobs.de',
            'stellenanzeigen.de',
            'meinestadt.de',
            'gelbeseiten.de',
            'dasoertliche.de',
            'goyellow.de',
            'branchenbuch.de',
            'firmenwissen.de',
            'unternehmensregister.de',
            'handelsregister.de',
            'northdata.de',
            'companyhouse.de',
            'softgarden.de',
            'softgarden.io',
            'contactrh.com',
            'easyapply.jobs',
            'guidecom.de',
            'bewerbung.de',
            'karriere.de',
            'jobboerse.de'
        ]
        
        # Check if domain contains any portal keywords
        domain_lower = domain.lower()
        for portal in known_portals:
            if portal in domain_lower:
                return True
        
        # Check for subdomain patterns
        if any(pattern in domain_lower for pattern in ['jobs.', 'karriere.', 'bewerbung.']):
            # But allow if it's a company subdomain (e.g., jobs.mercedes-benz.com)
            parts = domain_lower.split('.')
            if len(parts) > 2 and parts[0] in ['jobs', 'karriere', 'bewerbung']:
                # This might be a company's job subdomain
                return False
            return True
        
        return False
    
    async def get_best_matches(self, results: List[Dict], company_name: str,
                             postal_code: str = None) -> List[Dict]:
        """
        Filter and rank results to find best matches
        
        Args:
            results: Google search results
            company_name: Original company name
            postal_code: Expected postal code
            
        Returns:
            Sorted list of best matches
        """
        from company_name_matcher import CompanyNameMatcher
        matcher = CompanyNameMatcher()
        
        scored_results = []
        
        for result in results:
            score = 0.0
            
            # Skip known portals unless no other results
            if result.get('is_portal'):
                score -= 0.5
            
            # Check title similarity
            title = result.get('title', '')
            title_similarity = matcher.calculate_similarity(company_name, title)
            score += title_similarity * 0.4
            
            # Check snippet for company name
            snippet = result.get('snippet', '').lower()
            normalized_name = matcher.normalize_company_name(company_name)
            if normalized_name in snippet.lower():
                score += 0.2
            
            # Check for postal code in snippet
            if postal_code and postal_code in snippet:
                score += 0.3
            
            # Prefer .de domains for German companies
            domain = result.get('domain', '')
            if domain.endswith('.de'):
                score += 0.1
            
            # Store score
            result['relevance_score'] = score
            scored_results.append(result)
        
        # Sort by score
        scored_results.sort(key=lambda x: x['relevance_score'], reverse=True)
        
        return scored_results


# Example usage
if __name__ == "__main__":
    async def test_search():
        searcher = GoogleDomainSearcher()
        
        # Test search
        results = await searcher.search_employer(
            company_name="Mercedes-Benz Vertrieb Deutschland",
            street="Mercedesstraße 137",
            postal_code="70327",
            city="Stuttgart"
        )
        
        print(f"Found {len(results)} results:")
        for i, result in enumerate(results):
            print(f"\n{i+1}. {result['title']}")
            print(f"   URL: {result['url']}")
            print(f"   Domain: {result['domain']}")
            print(f"   Is Portal: {result.get('is_portal', False)}")
            print(f"   Snippet: {result['snippet'][:100]}...")
        
        # Get best matches
        best_matches = await searcher.get_best_matches(
            results, 
            "Mercedes-Benz Vertrieb Deutschland",
            "70327"
        )
        
        print("\n\nBest matches:")
        for i, result in enumerate(best_matches[:3]):
            print(f"\n{i+1}. {result['title']} (Score: {result['relevance_score']:.2f})")
            print(f"   Domain: {result['domain']}")
    
    # Run test
    asyncio.run(test_search())