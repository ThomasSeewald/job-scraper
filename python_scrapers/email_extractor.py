import re
from typing import List, Set, Dict
import logging

logger = logging.getLogger(__name__)

class EmailExtractor:
    """Extract and validate email addresses from text content"""
    
    def __init__(self):
        # Email pattern
        self.email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        
        # Common exclude patterns
        self.exclude_patterns = [
            '@arbeitsagentur.de',
            '@jobboerse.arbeitsagentur.de',
            'example.com',
            'example.de',
            'test@',
            'noreply@',
            'no-reply@',
            'donotreply@',
            'info@domain',
            'kontakt@domain',
            'bewerbung@domain'
        ]
        
        # Valid TLDs to ensure quality
        self.valid_tlds = {
            'de', 'com', 'org', 'net', 'eu', 'info', 'biz', 
            'at', 'ch', 'fr', 'nl', 'be', 'it', 'es', 'co.uk'
        }
        
    def extract_emails(self, text: str) -> List[str]:
        """Extract valid email addresses from text"""
        if not text:
            return []
            
        # Find all potential emails
        potential_emails = self.email_pattern.findall(text)
        
        # Filter and validate
        valid_emails = []
        for email in potential_emails:
            email_lower = email.lower()
            
            # Skip if matches exclude pattern
            if any(exclude in email_lower for exclude in self.exclude_patterns):
                continue
                
            # Check TLD
            tld = email_lower.split('.')[-1]
            if tld not in self.valid_tlds:
                continue
                
            # Basic validation
            if len(email) < 6 or len(email) > 100:
                continue
                
            # Check for reasonable structure
            local, domain = email_lower.split('@')
            if len(local) < 1 or len(domain) < 4:
                continue
                
            valid_emails.append(email_lower)
            
        # Remove duplicates while preserving order
        seen = set()
        unique_emails = []
        for email in valid_emails:
            if email not in seen:
                seen.add(email)
                unique_emails.append(email)
                
        return unique_emails
        
    def extract_domain(self, text: str) -> str:
        """Extract domain from text or email"""
        if '@' in text:
            return text.split('@')[1].lower()
            
        # Try to extract domain from URL
        url_pattern = re.compile(r'https?://(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})')
        match = url_pattern.search(text)
        if match:
            return match.group(1).lower()
            
        return ''
        
    def prioritize_emails(self, emails: List[str], company_name: str = '') -> List[str]:
        """Prioritize emails based on relevance"""
        if not emails:
            return []
            
        # Score each email
        scored_emails = []
        for email in emails:
            score = 0
            
            # Prefer emails with company name
            if company_name and company_name.lower() in email:
                score += 10
                
            # Prefer specific departments
            if any(dept in email for dept in ['personal', 'hr', 'bewerbung', 'karriere', 'jobs']):
                score += 5
                
            # Prefer .de domains for German companies
            if email.endswith('.de'):
                score += 2
                
            # Penalize generic emails
            if any(generic in email for generic in ['info@', 'kontakt@', 'mail@']):
                score -= 2
                
            scored_emails.append((email, score))
            
        # Sort by score (descending) and return
        scored_emails.sort(key=lambda x: x[1], reverse=True)
        return [email for email, _ in scored_emails]
        
    def extract_from_page_content(self, page_content: str, company_name: str = '') -> Dict[str, any]:
        """Extract all email-related information from page content"""
        emails = self.extract_emails(page_content)
        
        # Extract domains
        domains = set()
        for email in emails:
            domain = self.extract_domain(email)
            if domain:
                domains.add(domain)
                
        # Prioritize emails
        prioritized_emails = self.prioritize_emails(emails, company_name)
        
        return {
            'emails': prioritized_emails,
            'domains': list(domains),
            'email_count': len(emails),
            'has_emails': len(emails) > 0,
            'primary_email': prioritized_emails[0] if prioritized_emails else None,
            'primary_domain': list(domains)[0] if domains else None
        }


def test_email_extractor():
    """Test the email extractor"""
    extractor = EmailExtractor()
    
    test_text = """
    Kontaktieren Sie uns unter bewerbung@example-company.de oder 
    info@example-company.de. Weitere Informationen finden Sie auf 
    unserer Website. HR Department: personal@example-company.de
    
    Invalid emails: test@, noreply@arbeitsagentur.de, fake@example.com
    """
    
    result = extractor.extract_from_page_content(test_text, 'Example Company')
    print("Extraction result:", result)
    
    
if __name__ == '__main__':
    test_email_extractor()