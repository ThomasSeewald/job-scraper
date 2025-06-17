#!/usr/bin/env python3
"""
Single Google search script for dashboard integration
Performs one search and returns results as JSON
"""

import sys
import json
import asyncio
from typing import Dict, Optional

# Import the Google domain searcher
from google_domain_searcher import GoogleDomainSearcher
from keyword_searcher import KeywordSearcher


async def search_employer(employer_name: str, postal_code: Optional[str] = None) -> Dict:
    """Search for a single employer and return results"""
    try:
        searcher = GoogleDomainSearcher()
        
        # Perform search
        results = await searcher.search_employer(
            company_name=employer_name,
            postal_code=postal_code,
            num_results=5
        )
        
        if not results:
            return {
                'success': False,
                'error': 'No results found'
            }
        
        # Get best matches
        best_matches = await searcher.get_best_matches(
            results, employer_name, postal_code
        )
        
        if not best_matches:
            return {
                'success': False,
                'error': 'No relevant matches found'
            }
        
        # Take the top match
        top_match = best_matches[0]
        domain = top_match.get('domain')
        
        if not domain or top_match.get('is_portal'):
            return {
                'success': False,
                'error': 'Top result is a portal/directory'
            }
        
        # Try to extract emails from the domain
        emails = []
        try:
            keyword_searcher = KeywordSearcher()
            
            # Try impressum first (required in Germany)
            impressum_result = await keyword_searcher.search_keyword_on_domain(
                domain, 'impressum'
            )
            
            if impressum_result.get('emails'):
                emails = impressum_result['emails']
            else:
                # Try contact page
                contact_result = await keyword_searcher.search_keyword_on_domain(
                    domain, 'kontakt'
                )
                
                if contact_result.get('emails'):
                    emails = contact_result['emails']
                else:
                    # Try jobs/karriere page
                    for keyword in ['karriere', 'jobs', 'career']:
                        result = await keyword_searcher.search_keyword_on_domain(
                            domain, keyword
                        )
                        if result.get('emails'):
                            emails = result['emails']
                            break
                            
        except Exception as e:
            # Email extraction failed, but we still have the domain
            pass
        
        return {
            'success': True,
            'domain': domain,
            'emails': emails,
            'match_score': top_match.get('match_score', 0),
            'source': 'google_api'
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


async def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Employer name required'
        }))
        sys.exit(1)
    
    employer_name = sys.argv[1]
    postal_code = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = await search_employer(employer_name, postal_code)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())