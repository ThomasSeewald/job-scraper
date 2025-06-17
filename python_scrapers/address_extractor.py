#!/usr/bin/env python3
"""
Address Extractor
Extracts and validates German addresses from impressum pages using libpostal
Based on recommendations from ChatGPT conversation
"""

import re
import logging
from typing import List, Dict, Optional, Tuple
from bs4 import BeautifulSoup
import requests

# Try to import libpostal, provide fallback if not installed
try:
    from postal.parser import parse_address
    from postal.expand import expand_address
    LIBPOSTAL_AVAILABLE = True
except ImportError:
    LIBPOSTAL_AVAILABLE = False
    logging.warning("libpostal not installed. Using fallback address extraction.")

logger = logging.getLogger(__name__)


class AddressExtractor:
    """Extract and validate addresses from German impressum pages"""
    
    # German postal code pattern
    GERMAN_PLZ_PATTERN = r'\b[0-9]{5}\b'
    
    # Common German street suffixes
    STREET_SUFFIXES = [
        'straße', 'strasse', 'str.', 'str', 'weg', 'allee', 'platz', 'ring',
        'damm', 'ufer', 'chaussee', 'gasse', 'pfad', 'steig', 'berg', 'tal',
        'hof', 'markt', 'promenade'
    ]
    
    # Address patterns for regex-based extraction
    ADDRESS_PATTERNS = [
        # Pattern 1: Street number PLZ City
        r'([A-Za-zäöüÄÖÜß\s\-\.]+\s+\d+[a-zA-Z]?)\s*,?\s*(\d{5})\s+([A-Za-zäöüÄÖÜß\s\-]+)',
        
        # Pattern 2: Company name\nStreet number\nPLZ City
        r'([A-Za-zäöüÄÖÜß\s\-\.]+)\n([A-Za-zäöüÄÖÜß\s\-\.]+\s+\d+[a-zA-Z]?)\s*\n(\d{5})\s+([A-Za-zäöüÄÖÜß\s\-]+)',
        
        # Pattern 3: Street number, PLZ City (with comma)
        r'([A-Za-zäöüÄÖÜß\s\-\.]+\s+\d+[a-zA-Z]?),\s*(\d{5})\s+([A-Za-zäöüÄÖÜß\s\-]+)',
        
        # Pattern 4: More flexible pattern
        r'([A-Za-zäöüÄÖÜß][A-Za-zäöüÄÖÜß\s\-\.]*?(?:straße|strasse|str\.?|weg|allee|platz|ring|damm|ufer|chaussee|gasse|pfad|steig|berg|tal|hof|markt|promenade)[A-Za-zäöüÄÖÜß\s\-\.]*?\s+\d+[a-zA-Z]?)\s*[,\n]?\s*(\d{5})\s+([A-Za-zäöüÄÖÜß\s\-]+)'
    ]
    
    def __init__(self):
        """Initialize address extractor"""
        self.libpostal_available = LIBPOSTAL_AVAILABLE
        
    def clean_html_text(self, html_content: str) -> str:
        """
        Clean HTML content and extract text
        
        Args:
            html_content: Raw HTML content
            
        Returns:
            Cleaned text
        """
        # Parse HTML
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        
        # Get text
        text = soup.get_text()
        
        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\n'.join(chunk for chunk in chunks if chunk)
        
        return text
    
    def extract_address_candidates(self, text: str) -> List[str]:
        """
        Extract potential address candidates from text using regex
        
        Args:
            text: Text to search for addresses
            
        Returns:
            List of potential address strings
        """
        candidates = []
        
        # Find all German postal codes first
        plz_matches = re.finditer(self.GERMAN_PLZ_PATTERN, text)
        
        for plz_match in plz_matches:
            plz = plz_match.group()
            plz_pos = plz_match.start()
            
            # Extract context around PLZ (before and after)
            start = max(0, plz_pos - 150)
            end = min(len(text), plz_pos + 100)
            context = text[start:end]
            
            # Try different patterns
            for pattern in self.ADDRESS_PATTERNS:
                matches = re.finditer(pattern, context, re.IGNORECASE | re.MULTILINE)
                for match in matches:
                    address = ' '.join(match.groups())
                    # Clean up the address
                    address = re.sub(r'\s+', ' ', address).strip()
                    if address and plz in address:
                        candidates.append(address)
            
            # Also try a simple extraction around PLZ
            # Look for street-like patterns before PLZ
            before_plz = text[max(0, plz_pos - 100):plz_pos].strip()
            after_plz = text[plz_pos + 5:min(len(text), plz_pos + 50)].strip()
            
            # Check if before_plz contains a street pattern
            street_pattern = r'([A-Za-zäöüÄÖÜß\s\-\.]+\s+\d+[a-zA-Z]?)$'
            street_match = re.search(street_pattern, before_plz)
            
            if street_match and after_plz:
                # Extract city name (first words after PLZ)
                city_match = re.match(r'^([A-Za-zäöüÄÖÜß\s\-]+)', after_plz)
                if city_match:
                    street = street_match.group(1).strip()
                    city = city_match.group(1).strip()
                    full_address = f"{street} {plz} {city}"
                    candidates.append(full_address)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_candidates = []
        for candidate in candidates:
            normalized = ' '.join(candidate.split()).lower()
            if normalized not in seen:
                seen.add(normalized)
                unique_candidates.append(candidate)
        
        return unique_candidates
    
    def parse_with_libpostal(self, address: str) -> Dict[str, str]:
        """
        Parse address using libpostal
        
        Args:
            address: Address string to parse
            
        Returns:
            Parsed address components
        """
        if not self.libpostal_available:
            return self.parse_with_regex(address)
        
        try:
            # Parse address
            parsed = parse_address(address)
            
            # Convert to dictionary
            components = {}
            for value, label in parsed:
                if label not in components:
                    components[label] = value
                else:
                    components[label] += ' ' + value
            
            return components
            
        except Exception as e:
            logger.warning(f"libpostal parsing failed: {e}")
            return self.parse_with_regex(address)
    
    def parse_with_regex(self, address: str) -> Dict[str, str]:
        """
        Fallback regex-based address parser
        
        Args:
            address: Address string to parse
            
        Returns:
            Parsed address components
        """
        components = {'original': address}
        
        # Extract PLZ
        plz_match = re.search(self.GERMAN_PLZ_PATTERN, address)
        if plz_match:
            components['postcode'] = plz_match.group()
            
            # Extract parts before and after PLZ
            plz_pos = plz_match.start()
            before_plz = address[:plz_pos].strip().rstrip(',')
            after_plz = address[plz_pos + 5:].strip()
            
            # Before PLZ is likely street and house number
            if before_plz:
                # Check if it ends with a number (house number)
                house_match = re.search(r'\s+(\d+[a-zA-Z]?)$', before_plz)
                if house_match:
                    components['house_number'] = house_match.group(1)
                    components['road'] = before_plz[:house_match.start()].strip()
                else:
                    components['road'] = before_plz
            
            # After PLZ is likely city
            if after_plz:
                components['city'] = after_plz.split(',')[0].strip()
        
        return components
    
    def validate_address(self, address_components: Dict[str, str], 
                        target_plz: str = None) -> Tuple[bool, float]:
        """
        Validate if extracted address is valid
        
        Args:
            address_components: Parsed address components
            target_plz: Expected postal code (optional)
            
        Returns:
            Tuple of (is_valid, confidence_score)
        """
        # Check required components
        has_street = any(key in address_components for key in ['road', 'street'])
        has_plz = 'postcode' in address_components
        has_city = any(key in address_components for key in ['city', 'locality'])
        
        if not (has_street and has_plz):
            return False, 0.0
        
        # Calculate confidence score
        confidence = 0.0
        
        # Base score for having components
        if has_street:
            confidence += 0.3
        if has_plz:
            confidence += 0.3
        if has_city:
            confidence += 0.2
        if 'house_number' in address_components:
            confidence += 0.2
        
        # Check PLZ match if target provided
        if target_plz and has_plz:
            if address_components['postcode'] == target_plz:
                confidence = min(1.0, confidence + 0.3)
            else:
                confidence *= 0.5  # Reduce confidence if PLZ doesn't match
        
        return confidence > 0.5, confidence
    
    def extract_addresses_from_url(self, url: str) -> List[Dict[str, any]]:
        """
        Extract addresses from a webpage URL
        
        Args:
            url: URL to extract addresses from
            
        Returns:
            List of extracted addresses with components
        """
        try:
            # Fetch webpage
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            # Clean HTML
            text = self.clean_html_text(response.text)
            
            # Extract candidates
            candidates = self.extract_address_candidates(text)
            
            # Parse and validate each candidate
            addresses = []
            for candidate in candidates:
                components = self.parse_with_libpostal(candidate)
                is_valid, confidence = self.validate_address(components)
                
                if is_valid:
                    addresses.append({
                        'raw': candidate,
                        'components': components,
                        'confidence': confidence
                    })
            
            # Sort by confidence
            addresses.sort(key=lambda x: x['confidence'], reverse=True)
            
            return addresses
            
        except Exception as e:
            logger.error(f"Error extracting addresses from {url}: {e}")
            return []
    
    def find_employer_address(self, addresses: List[Dict], employer_name: str,
                            target_plz: str = None) -> Optional[Dict]:
        """
        Find the most likely employer address from extracted addresses
        
        Args:
            addresses: List of extracted addresses
            employer_name: Name of the employer
            target_plz: Expected postal code
            
        Returns:
            Best matching address or None
        """
        if not addresses:
            return None
        
        # Filter by PLZ if provided
        if target_plz:
            plz_matches = [
                addr for addr in addresses 
                if addr['components'].get('postcode') == target_plz
            ]
            if plz_matches:
                addresses = plz_matches
        
        # Return highest confidence address
        return addresses[0] if addresses else None


# Example usage
if __name__ == "__main__":
    extractor = AddressExtractor()
    
    # Test text with addresses
    test_text = """
    Impressum
    
    Mercedes-Benz Vertrieb Deutschland
    Mercedesstraße 137
    70327 Stuttgart
    Deutschland
    
    Telefon: +49 711 17-0
    E-Mail: info@mercedes-benz.de
    
    Handelsregister: Amtsgericht Stuttgart, HRB 762873
    """
    
    # Extract addresses
    candidates = extractor.extract_address_candidates(test_text)
    print("Found address candidates:")
    for candidate in candidates:
        print(f"  - {candidate}")
        parsed = extractor.parse_with_libpostal(candidate)
        print(f"    Parsed: {parsed}")
        is_valid, confidence = extractor.validate_address(parsed, "70327")
        print(f"    Valid: {is_valid}, Confidence: {confidence:.2f}")
        print()