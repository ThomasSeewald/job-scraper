#!/usr/bin/env python3
"""
Google Domains Client
Client library for accessing the Google Domains API from other projects
Can be imported by job scraper, yellow pages, or any other project
"""

import requests
import logging
from typing import Dict, List, Optional
from urllib.parse import urljoin

logger = logging.getLogger(__name__)


class GoogleDomainsClient:
    """Client for Google Domains API Service"""
    
    def __init__(self, base_url: str = "http://localhost:5000", 
                 source_system: str = "unknown"):
        """
        Initialize client
        
        Args:
            base_url: Base URL of the Google Domains API
            source_system: Name of the system using this client
        """
        self.base_url = base_url
        self.source_system = source_system
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': f'GoogleDomainsClient/{source_system}'
        })
    
    def search_domain(self, company_name: str, street: str = None,
                     postal_code: str = None, city: str = None) -> Dict:
        """
        Search for employer domain
        
        Args:
            company_name: Company name to search
            street: Street address (optional)
            postal_code: Postal code (optional)
            city: City (optional)
            
        Returns:
            Search result with domain information
        """
        endpoint = urljoin(self.base_url, '/api/search')
        
        payload = {
            'company_name': company_name,
            'street': street,
            'postal_code': postal_code,
            'city': city,
            'source': self.source_system
        }
        
        try:
            response = self.session.post(endpoint, json=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error searching domain: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }
    
    def verify_domain(self, domain: str, company_name: str,
                     street: str = None, postal_code: str = None) -> Dict:
        """
        Verify if a domain belongs to a company
        
        Args:
            domain: Domain to verify
            company_name: Company name
            street: Street address (optional)
            postal_code: Postal code (optional)
            
        Returns:
            Verification result
        """
        endpoint = urljoin(self.base_url, '/api/verify')
        
        payload = {
            'domain': domain,
            'company_name': company_name,
            'street': street,
            'postal_code': postal_code,
            'source': self.source_system
        }
        
        try:
            response = self.session.post(endpoint, json=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error verifying domain: {e}")
            return {
                'verified': False,
                'error': str(e)
            }
    
    def extract_emails(self, domain: str, 
                      pages: List[str] = None) -> Dict[str, List[str]]:
        """
        Extract emails from a domain
        
        Args:
            domain: Domain to extract emails from
            pages: List of page types to check
            
        Returns:
            Dictionary of emails by page type
        """
        endpoint = urljoin(self.base_url, '/api/extract-emails')
        
        payload = {
            'domain': domain,
            'pages': pages or ['impressum', 'kontakt'],
            'source': self.source_system
        }
        
        try:
            response = self.session.post(endpoint, json=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error extracting emails: {e}")
            return {
                'error': str(e),
                'emails': {}
            }
    
    def find_similar_companies(self, company_name: str, 
                             postal_code: str = None,
                             threshold: float = 0.7) -> Dict:
        """
        Find similar companies in the database
        
        Args:
            company_name: Company name to search
            postal_code: Optional postal code filter
            threshold: Similarity threshold (0-1)
            
        Returns:
            Search result
        """
        endpoint = urljoin(self.base_url, '/api/similar')
        
        params = {
            'company': company_name,
            'postal_code': postal_code,
            'threshold': threshold
        }
        
        try:
            response = self.session.get(endpoint, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error finding similar companies: {e}")
            return {
                'found': False,
                'error': str(e)
            }
    
    def get_stats(self) -> Dict:
        """
        Get service statistics
        
        Returns:
            Statistics dictionary
        """
        endpoint = urljoin(self.base_url, '/api/stats')
        
        try:
            response = self.session.get(endpoint)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting stats: {e}")
            return {
                'error': str(e)
            }
    
    def close(self):
        """Close the session"""
        self.session.close()


# Convenience function for one-off searches
def search_employer_domain(company_name: str, street: str = None,
                         postal_code: str = None, city: str = None,
                         source: str = "manual") -> Dict:
    """
    Convenience function for one-off domain searches
    
    Args:
        company_name: Company name
        street: Street address
        postal_code: Postal code
        city: City
        source: Source system name
        
    Returns:
        Search result
    """
    client = GoogleDomainsClient(source_system=source)
    try:
        return client.search_domain(company_name, street, postal_code, city)
    finally:
        client.close()


# Example usage showing how other projects can use this
if __name__ == "__main__":
    # Example 1: Job Scraper usage
    print("=== Job Scraper Example ===")
    job_client = GoogleDomainsClient(source_system="job_scraper")
    
    # Search for a domain
    result = job_client.search_domain(
        company_name="Mercedes-Benz Vertrieb Deutschland",
        street="Mercedesstraße 137",
        postal_code="70327"
    )
    
    print(f"Search result: {result}")
    
    if result.get('domain'):
        # Extract emails from the found domain
        emails = job_client.extract_emails(result['domain'])
        print(f"Emails found: {emails}")
    
    job_client.close()
    
    # Example 2: Yellow Pages usage
    print("\n=== Yellow Pages Example ===")
    yellow_client = GoogleDomainsClient(source_system="yellow_pages")
    
    # Check if we already have this company
    similar = yellow_client.find_similar_companies(
        "Müller GmbH",
        postal_code="10117"
    )
    
    if similar['found']:
        print(f"Found existing entry: {similar['result']}")
    else:
        # Search for new domain
        result = yellow_client.search_domain(
            company_name="Müller GmbH",
            postal_code="10117",
            city="Berlin"
        )
        print(f"New search result: {result}")
    
    yellow_client.close()
    
    # Example 3: One-off search
    print("\n=== One-off Search Example ===")
    quick_result = search_employer_domain(
        "Siemens AG",
        postal_code="80333",
        city="München",
        source="manual_test"
    )
    print(f"Quick search result: {quick_result}")