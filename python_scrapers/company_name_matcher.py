#!/usr/bin/env python3
"""
Company Name Matcher
Handles fuzzy matching for German company names with various forms
"""

import re
from typing import List, Tuple, Optional
import unicodedata
import logging

logger = logging.getLogger(__name__)


class CompanyNameMatcher:
    """Handles fuzzy matching and normalization for German company names"""
    
    # Common German company form variations
    COMPANY_FORMS = {
        'gmbh': [
            'gmbh', 'g.m.b.h.', 'g.m.b.h', 'g m b h', 'gesellschaft mit beschränkter haftung',
            'gesellschaft m.b.h.', 'ges.m.b.h.', 'ges. m. b. h.'
        ],
        'ag': [
            'ag', 'a.g.', 'a. g.', 'aktiengesellschaft', 'aktien gesellschaft'
        ],
        'kg': [
            'kg', 'k.g.', 'k. g.', 'kommanditgesellschaft', 'kommandit gesellschaft'
        ],
        'ohg': [
            'ohg', 'o.h.g.', 'o. h. g.', 'offene handelsgesellschaft'
        ],
        'gbr': [
            'gbr', 'g.b.r.', 'g. b. r.', 'gesellschaft bürgerlichen rechts',
            'gesellschaft des bürgerlichen rechts'
        ],
        'ug': [
            'ug', 'u.g.', 'u. g.', 'unternehmergesellschaft', 'unternehmergesellschaft (haftungsbeschränkt)'
        ],
        'eg': [
            'eg', 'e.g.', 'e. g.', 'eingetragene genossenschaft'
        ],
        'co': [
            'co', 'co.', '& co', '& co.', 'und co', 'und co.', '+ co', '+ co.'
        ],
        'und': [
            'und', '&', 'u.', '+', 'and'
        ],
        'mbh': [
            'mbh', 'm.b.h.', 'm. b. h.'  # Sometimes used alone
        ]
    }
    
    # Common abbreviations in company names
    ABBREVIATIONS = {
        'str': ['str', 'str.', 'strasse', 'straße'],
        'dr': ['dr', 'dr.', 'doktor'],
        'prof': ['prof', 'prof.', 'professor'],
        'ing': ['ing', 'ing.', 'ingenieur'],
        'dipl': ['dipl', 'dipl.', 'diplom'],
        'jr': ['jr', 'jr.', 'junior'],
        'sr': ['sr', 'sr.', 'senior']
    }
    
    @staticmethod
    def remove_accents(text: str) -> str:
        """Remove accents and special characters"""
        # Normalize to NFD (decomposed form)
        nfd = unicodedata.normalize('NFD', text)
        # Filter out combining characters (accents)
        return ''.join(char for char in nfd if unicodedata.category(char) != 'Mn')
    
    @staticmethod
    def normalize_company_name(name: str) -> str:
        """
        Normalize company name for consistent matching
        
        Args:
            name: Original company name
            
        Returns:
            Normalized company name
        """
        if not name:
            return ""
        
        # Convert to lowercase
        normalized = name.lower().strip()
        
        # Handle special German characters
        normalized = normalized.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
        normalized = normalized.replace('ß', 'ss')
        
        # Remove accents from other characters
        normalized = CompanyNameMatcher.remove_accents(normalized)
        
        # Remove extra spaces, tabs, newlines
        normalized = re.sub(r'\s+', ' ', normalized)
        
        # Standardize punctuation
        normalized = re.sub(r'[.,\-_/\\|]', ' ', normalized)
        normalized = re.sub(r'[\'"`´']', '', normalized)  # Remove quotes
        normalized = re.sub(r'[()[\]{}]', ' ', normalized)  # Remove brackets
        
        # Standardize company forms
        for standard, variations in CompanyNameMatcher.COMPANY_FORMS.items():
            for variant in variations:
                # Use word boundaries to avoid partial matches
                pattern = r'\b' + re.escape(variant) + r'\b'
                normalized = re.sub(pattern, standard, normalized, flags=re.IGNORECASE)
        
        # Standardize common abbreviations
        for standard, variations in CompanyNameMatcher.ABBREVIATIONS.items():
            for variant in variations:
                pattern = r'\b' + re.escape(variant) + r'\b'
                normalized = re.sub(pattern, standard, normalized, flags=re.IGNORECASE)
        
        # Remove multiple spaces again after replacements
        normalized = re.sub(r'\s+', ' ', normalized).strip()
        
        return normalized
    
    @staticmethod
    def extract_base_name(company_name: str) -> str:
        """
        Extract base company name without legal forms
        
        Args:
            company_name: Full company name
            
        Returns:
            Base name without legal forms
        """
        normalized = CompanyNameMatcher.normalize_company_name(company_name)
        
        # Create a list of all legal form keywords to remove
        legal_forms = []
        for forms in CompanyNameMatcher.COMPANY_FORMS.values():
            legal_forms.extend([CompanyNameMatcher.normalize_company_name(f) for f in forms])
        
        # Split into words and filter out legal forms
        words = normalized.split()
        base_words = []
        
        skip_next = False
        for i, word in enumerate(words):
            if skip_next:
                skip_next = False
                continue
                
            # Skip if it's a legal form
            if word in legal_forms:
                # Also skip '&' or 'und' if it comes before a legal form
                if base_words and base_words[-1] in ['&', 'und', '+']:
                    base_words.pop()
                continue
            
            # Skip connecting words before legal forms
            if word in ['&', 'und', '+'] and i + 1 < len(words) and words[i + 1] in legal_forms:
                skip_next = True
                continue
                
            base_words.append(word)
        
        return ' '.join(base_words).strip()
    
    @staticmethod
    def get_search_variations(company_name: str) -> List[str]:
        """
        Generate search variations for a company name
        
        Args:
            company_name: Original company name
            
        Returns:
            List of search variations
        """
        variations = set()
        
        # Add original
        variations.add(company_name)
        
        # Add normalized version
        normalized = CompanyNameMatcher.normalize_company_name(company_name)
        variations.add(normalized)
        
        # Add base name without legal forms
        base_name = CompanyNameMatcher.extract_base_name(company_name)
        if base_name:
            variations.add(base_name)
            
            # Add common legal form combinations with base name
            for form in ['gmbh', 'ag', 'kg', 'gmbh & co kg']:
                variations.add(f"{base_name} {form}")
        
        # Handle special cases for quotes in search
        # Google often has issues with exact match quotes
        if base_name:
            # Try with partial quotes (just around specific parts)
            words = base_name.split()
            if len(words) > 1:
                # Quote just the main part (first 2-3 words)
                variations.add(f'"{" ".join(words[:min(3, len(words))])}"')
        
        # Remove empty strings and duplicates
        variations = {v for v in variations if v}
        
        return list(variations)
    
    @staticmethod
    def calculate_similarity(name1: str, name2: str) -> float:
        """
        Calculate similarity between two company names
        Uses base name comparison for better matching
        
        Args:
            name1: First company name
            name2: Second company name
            
        Returns:
            Similarity score (0-1)
        """
        # Normalize both names
        norm1 = CompanyNameMatcher.normalize_company_name(name1)
        norm2 = CompanyNameMatcher.normalize_company_name(name2)
        
        # Quick exact match check
        if norm1 == norm2:
            return 1.0
        
        # Extract base names
        base1 = CompanyNameMatcher.extract_base_name(name1)
        base2 = CompanyNameMatcher.extract_base_name(name2)
        
        # If base names match exactly, high similarity
        if base1 and base2 and base1 == base2:
            return 0.95
        
        # Use word overlap for similarity
        words1 = set(norm1.split())
        words2 = set(norm2.split())
        
        # Remove common legal form words for comparison
        legal_words = set()
        for forms in CompanyNameMatcher.COMPANY_FORMS.values():
            legal_words.update([CompanyNameMatcher.normalize_company_name(f) for f in forms])
        
        words1_filtered = words1 - legal_words
        words2_filtered = words2 - legal_words
        
        # If no meaningful words left, use original
        if not words1_filtered:
            words1_filtered = words1
        if not words2_filtered:
            words2_filtered = words2
        
        # Calculate Jaccard similarity
        intersection = len(words1_filtered & words2_filtered)
        union = len(words1_filtered | words2_filtered)
        
        if union == 0:
            return 0.0
            
        return intersection / union
    
    @staticmethod
    def is_likely_match(name1: str, name2: str, threshold: float = 0.7) -> bool:
        """
        Check if two company names are likely the same company
        
        Args:
            name1: First company name
            name2: Second company name
            threshold: Minimum similarity score
            
        Returns:
            True if likely match
        """
        similarity = CompanyNameMatcher.calculate_similarity(name1, name2)
        return similarity >= threshold


# Example usage and tests
if __name__ == "__main__":
    matcher = CompanyNameMatcher()
    
    # Test normalization
    test_names = [
        "Mercedes-Benz Vertrieb Deutschland GmbH",
        "Mercedes Benz Vertrieb Deutschland G.m.b.H.",
        "MERCEDES-BENZ VERTRIEB DEUTSCHLAND Gesellschaft mit beschränkter Haftung",
        "Müller & Schmidt GmbH & Co. KG",
        "Müller und Schmidt GmbH und Co KG",
        "Dr. Ing. h.c. F. Porsche AG",
        "Dr.-Ing. h.c. F. Porsche Aktiengesellschaft"
    ]
    
    print("=== Normalization Tests ===")
    for name in test_names:
        normalized = matcher.normalize_company_name(name)
        base = matcher.extract_base_name(name)
        print(f"Original: {name}")
        print(f"Normalized: {normalized}")
        print(f"Base name: {base}")
        print(f"Variations: {matcher.get_search_variations(name)}")
        print("-" * 50)
    
    print("\n=== Similarity Tests ===")
    pairs = [
        ("Mercedes-Benz GmbH", "Mercedes Benz G.m.b.H."),
        ("Müller & Co. KG", "Müller und Co KG"),
        ("Siemens AG", "Siemens Aktiengesellschaft"),
        ("BMW GmbH", "Volkswagen GmbH"),
    ]
    
    for name1, name2 in pairs:
        similarity = matcher.calculate_similarity(name1, name2)
        is_match = matcher.is_likely_match(name1, name2)
        print(f"{name1} <-> {name2}")
        print(f"Similarity: {similarity:.2f}, Match: {is_match}")
        print("-" * 30)