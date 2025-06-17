#!/usr/bin/env python3
"""
Google Domains API Service
A centralized service for domain discovery and verification
Accessible by job scraper, yellow pages, and other projects
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor, Json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import asyncio
import aiohttp
from concurrent.futures import ThreadPoolExecutor

# Import our components
from company_name_matcher import CompanyNameMatcher
from address_extractor import AddressExtractor
from google_domain_searcher import GoogleDomainSearcher
from domain_verifier import DomainVerifier

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for cross-project access

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5473,
    'database': 'jetzt',
    'user': 'odoo',
    'password': 'odoo'
}

# Initialize components
name_matcher = CompanyNameMatcher()
address_extractor = AddressExtractor()
google_searcher = GoogleDomainSearcher()
domain_verifier = DomainVerifier()

# Thread pool for async operations
executor = ThreadPoolExecutor(max_workers=4)


class GoogleDomainsService:
    """Main service class for domain operations"""
    
    @staticmethod
    def get_db_connection():
        """Get database connection"""
        return psycopg2.connect(**DB_CONFIG)
    
    @staticmethod
    def log_usage(source: str, action: str, company: str = None, 
                  domain: str = None, success: bool = True, details: Dict = None):
        """Log API usage for tracking"""
        conn = GoogleDomainsService.get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO google_domains_usage 
                (source_system, action, company_name, domain, success, details)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (source, action, company, domain, success, Json(details)))
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def find_existing_domain(company_name: str, postal_code: str = None,
                           similarity_threshold: float = 0.7) -> Optional[Dict]:
        """Find existing verified domain for company"""
        conn = GoogleDomainsService.get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            cursor.execute("""
                SELECT * FROM find_similar_companies(%s, %s, %s)
            """, (company_name, postal_code, similarity_threshold))
            
            results = cursor.fetchall()
            return results[0] if results else None
            
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    async def search_and_verify_domain(company_name: str, street: str = None,
                                     postal_code: str = None, city: str = None,
                                     source_system: str = 'unknown') -> Dict:
        """Main function to search and verify employer domain"""
        
        # Check for existing verified domain
        existing = GoogleDomainsService.find_existing_domain(company_name, postal_code)
        if existing and existing['similarity_score'] >= 0.85:
            logger.info(f"Found existing domain: {existing['domain']} (similarity: {existing['similarity_score']})")
            return {
                'status': 'cached',
                'domain': existing['domain'],
                'emails': existing['emails'],
                'similarity_score': existing['similarity_score'],
                'is_verified': existing['is_verified']
            }
        
        # Perform new Google search
        try:
            search_results = await google_searcher.search_employer(
                company_name, street, postal_code, city
            )
            
            # Process and store results
            verified_domain = None
            for idx, result in enumerate(search_results[:10]):
                # Store in database
                GoogleDomainsService.store_search_result(
                    company_name, street, postal_code, city,
                    result, idx + 1, source_system
                )
                
                # Verify if this is the actual employer domain
                if not verified_domain and result['domain']:
                    is_verified = await domain_verifier.verify_domain(
                        result['domain'], company_name, street, postal_code
                    )
                    if is_verified:
                        verified_domain = result
                        GoogleDomainsService.update_verification_status(
                            company_name, result['domain'], True, is_verified['score']
                        )
            
            return {
                'status': 'new_search',
                'domain': verified_domain['domain'] if verified_domain else None,
                'is_verified': bool(verified_domain),
                'search_results': len(search_results)
            }
            
        except Exception as e:
            logger.error(f"Search error: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }
    
    @staticmethod
    def store_search_result(company_name: str, street: str, postal_code: str,
                          city: str, result: Dict, position: int, source: str):
        """Store Google search result in database"""
        conn = GoogleDomainsService.get_db_connection()
        cursor = conn.cursor()
        
        try:
            query_full = f'{company_name} {street or ""} "{postal_code or ""}" {city or ""}'.strip()
            
            cursor.execute("""
                INSERT INTO google_domains_service (
                    query_company_name, query_street, query_postal_code, query_city,
                    query_full, query_source, result_title, result_url, result_snippet,
                    result_domain, result_position, google_api_response, created_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (query_company_name, result_domain) 
                DO UPDATE SET
                    result_position = LEAST(
                        google_domains_service.result_position, 
                        EXCLUDED.result_position
                    ),
                    updated_at = CURRENT_TIMESTAMP
            """, (
                company_name, street, postal_code, city, query_full, source,
                result.get('title'), result.get('url'), result.get('snippet'),
                result.get('domain'), position, Json(result), source
            ))
            
            conn.commit()
        finally:
            cursor.close()
            conn.close()
    
    @staticmethod
    def update_verification_status(company_name: str, domain: str, 
                                 is_verified: bool, score: float):
        """Update domain verification status"""
        conn = GoogleDomainsService.get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                UPDATE google_domains_service
                SET is_verified = %s,
                    verification_date = %s,
                    address_match_score = %s,
                    domain_type = 'employer',
                    domain_confidence = %s
                WHERE query_company_name = %s AND result_domain = %s
            """, (is_verified, datetime.now(), score, score, company_name, domain))
            
            conn.commit()
        finally:
            cursor.close()
            conn.close()


# API Routes

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'google_domains_api'})


@app.route('/api/search', methods=['POST'])
def search_domain():
    """
    Search for employer domain
    
    Request body:
    {
        "company_name": "Example GmbH",
        "street": "Main Street 123",
        "postal_code": "12345",
        "city": "Berlin",
        "source": "job_scraper"
    }
    """
    data = request.json
    source = data.get('source', 'unknown')
    
    # Log the request
    GoogleDomainsService.log_usage(
        source, 'search', data.get('company_name'), 
        details={'request': data}
    )
    
    # Run async search
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    result = loop.run_until_complete(
        GoogleDomainsService.search_and_verify_domain(
            data.get('company_name'),
            data.get('street'),
            data.get('postal_code'),
            data.get('city'),
            source
        )
    )
    
    return jsonify(result)


@app.route('/api/verify', methods=['POST'])
def verify_domain():
    """
    Verify if a domain belongs to a specific employer
    
    Request body:
    {
        "domain": "example.com",
        "company_name": "Example GmbH",
        "street": "Main Street 123",
        "postal_code": "12345",
        "source": "yellow_pages"
    }
    """
    data = request.json
    source = data.get('source', 'unknown')
    
    # Log the request
    GoogleDomainsService.log_usage(
        source, 'verify', data.get('company_name'), 
        data.get('domain'), details={'request': data}
    )
    
    # Run async verification
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    result = loop.run_until_complete(
        domain_verifier.verify_domain(
            data.get('domain'),
            data.get('company_name'),
            data.get('street'),
            data.get('postal_code')
        )
    )
    
    return jsonify(result)


@app.route('/api/extract-emails', methods=['POST'])
def extract_emails():
    """
    Extract emails from a domain
    
    Request body:
    {
        "domain": "example.com",
        "pages": ["impressum", "kontakt", "karriere"],
        "source": "manual"
    }
    """
    data = request.json
    domain = data.get('domain')
    pages = data.get('pages', ['impressum', 'kontakt'])
    source = data.get('source', 'unknown')
    
    # Log the request
    GoogleDomainsService.log_usage(
        source, 'extract_emails', domain=domain,
        details={'request': data}
    )
    
    # Extract emails
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    emails = loop.run_until_complete(
        domain_verifier.extract_emails_from_domain(domain, pages)
    )
    
    return jsonify({
        'domain': domain,
        'emails': emails,
        'total': len(emails.get('all', []))
    })


@app.route('/api/similar', methods=['GET'])
def find_similar():
    """
    Find similar companies
    
    Query params:
    - company: Company name to search
    - postal_code: Optional postal code
    - threshold: Similarity threshold (0-1)
    """
    company = request.args.get('company')
    postal_code = request.args.get('postal_code')
    threshold = float(request.args.get('threshold', 0.7))
    
    if not company:
        return jsonify({'error': 'Company name required'}), 400
    
    result = GoogleDomainsService.find_existing_domain(
        company, postal_code, threshold
    )
    
    return jsonify({
        'query': company,
        'found': bool(result),
        'result': result
    })


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get service statistics"""
    conn = GoogleDomainsService.get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Overall stats
        cursor.execute("""
            SELECT 
                COUNT(*) as total_domains,
                COUNT(DISTINCT query_company_name) as unique_companies,
                COUNT(CASE WHEN is_verified = true THEN 1 END) as verified_domains,
                COUNT(CASE WHEN all_emails IS NOT NULL THEN 1 END) as domains_with_emails
            FROM google_domains_service
        """)
        overall = cursor.fetchone()
        
        # Usage stats by source
        cursor.execute("""
            SELECT 
                source_system,
                COUNT(*) as requests,
                COUNT(CASE WHEN success = true THEN 1 END) as successful
            FROM google_domains_usage
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
            GROUP BY source_system
            ORDER BY requests DESC
        """)
        usage = cursor.fetchall()
        
        return jsonify({
            'overall': overall,
            'usage_by_source': usage
        })
        
    finally:
        cursor.close()
        conn.close()


if __name__ == '__main__':
    # Run the API server
    app.run(host='0.0.0.0', port=5000, debug=False)