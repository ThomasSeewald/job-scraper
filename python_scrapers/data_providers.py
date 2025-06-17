#!/usr/bin/env python3
"""
Data Provider Classes - Separation of Concerns
Handles data operations separately from scraping logic
"""

import logging
from typing import Dict, List, Optional, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta

from config import DB_CONFIG

logger = logging.getLogger(__name__)


class EmployerDataProvider:
    """Handles employer data operations and queue management"""
    
    def __init__(self):
        self.db_config = DB_CONFIG
        
    def get_db_connection(self):
        """Get a new database connection"""
        return psycopg2.connect(**self.db_config)
    
    def claim_next_employer(self, worker_id: int = 0) -> Optional[Tuple[str, str, str]]:
        """
        Atomically claim next employer for processing
        Returns: (employer_name, refnr, job_title) or None
        """
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Atomic claim with job info in one query
            cursor.execute("""
                WITH available_jobs AS (
                    SELECT j.refnr, j.titel, j.arbeitgeber, j.arbeitsort_plz, e.id as employer_id
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    INNER JOIN job_scrp_employers e ON e.name = j.arbeitgeber
                    WHERE e.email_extraction_attempted = false
                      AND j.externeurl IS NULL
                      AND j.refnr IS NOT NULL
                      AND j.is_active = true
                    ORDER BY j.aktuelleveroeffentlichungsdatum DESC
                    LIMIT 100
                )
                UPDATE job_scrp_employers 
                SET email_extraction_date = NOW(),
                    email_extraction_attempted = true
                FROM available_jobs
                WHERE job_scrp_employers.id = available_jobs.employer_id
                  AND job_scrp_employers.id = (
                    SELECT employer_id FROM available_jobs 
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                  )
                RETURNING job_scrp_employers.name, available_jobs.refnr, 
                         available_jobs.titel, available_jobs.arbeitsort_plz;
            """)
            
            result = cursor.fetchone()
            
            if result:
                conn.commit()
                return (result[0], result[1], result[2])  # name, refnr, titel (plz in result[3])
            
            return None
            
        except Exception as e:
            logger.error(f"Error claiming employer: {e}")
            if conn:
                conn.rollback()
            return None
        finally:
            if conn:
                conn.close()
    
    def save_scraping_results(self, employer_name: str, refnr: str, 
                            email_data: Dict[str, Any], success: bool):
        """Save scraping results to database"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Update employer
            if email_data.get('has_emails') or not success:
                cursor.execute("""
                    UPDATE job_scrp_employers 
                    SET contact_emails = %s,
                        website = %s
                    WHERE name = %s
                """, (
                    ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                    email_data.get('primary_domain'),
                    employer_name
                ))
            
            # Insert/update job_details
            cursor.execute("""
                INSERT INTO job_scrp_job_details (
                    reference_number, scraped_at, scraping_success,
                    has_emails, contact_emails, best_email,
                    company_domain, email_count, scraping_error,
                    email_source, scraping_duration_ms
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (reference_number) DO UPDATE SET
                    scraped_at = EXCLUDED.scraped_at,
                    scraping_success = EXCLUDED.scraping_success,
                    has_emails = EXCLUDED.has_emails,
                    contact_emails = EXCLUDED.contact_emails,
                    best_email = EXCLUDED.best_email,
                    company_domain = EXCLUDED.company_domain,
                    email_count = EXCLUDED.email_count,
                    scraping_error = EXCLUDED.scraping_error,
                    email_source = EXCLUDED.email_source,
                    scraping_duration_ms = EXCLUDED.scraping_duration_ms,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                refnr,
                datetime.now(),
                success,
                email_data.get('has_emails', False),
                ','.join(email_data.get('emails', [])) if email_data.get('emails') else None,
                email_data.get('primary_email'),
                email_data.get('primary_domain'),
                email_data.get('email_count', 0),
                email_data.get('error') if not success else None,
                email_data.get('source', 'arbeitsagentur'),
                email_data.get('duration_ms', 0)
            ))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error saving results: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                conn.close()


class DomainCacheProvider:
    """Handles domain cache operations (our_domains and our_google_domains)"""
    
    def __init__(self):
        self.db_config = DB_CONFIG
        
    def get_db_connection(self):
        """Get a new database connection"""
        return psycopg2.connect(**self.db_config)
    
    def check_domain_cache(self, employer_name: str, postal_code: Optional[str] = None) -> Optional[Dict]:
        """
        Check our_domains table for cached domain/email information
        Returns: Dict with domain and email info or None
        """
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # First try exact match with postal code
            if postal_code:
                cursor.execute("""
                    SELECT 
                        domain, best_domain, best_email,
                        email_impressum, email_contact, email_jobs,
                        COALESCE(email_impressum, email_contact, email_jobs, best_email) as any_email
                    FROM our_domains
                    WHERE LOWER(the_name) = LOWER(%s) 
                      AND zip = %s
                    LIMIT 1
                """, (employer_name, postal_code))
                
                result = cursor.fetchone()
                if result and (result['any_email'] or result['domain']):
                    return {
                        'found': True,
                        'source': 'our_domains_exact',
                        'domain': result.get('best_domain') or result.get('domain'),
                        'emails': self._extract_emails_from_result(result),
                        'has_emails': bool(result['any_email'])
                    }
            
            # Try fuzzy match without postal code
            cursor.execute("""
                SELECT 
                    domain, best_domain, best_email,
                    email_impressum, email_contact, email_jobs,
                    COALESCE(email_impressum, email_contact, email_jobs, best_email) as any_email,
                    similarity(LOWER(the_name), LOWER(%s)) as sim
                FROM our_domains
                WHERE LOWER(the_name) LIKE LOWER(%s)
                   OR similarity(LOWER(the_name), LOWER(%s)) > 0.7
                ORDER BY sim DESC
                LIMIT 1
            """, (employer_name, f'%{employer_name}%', employer_name))
            
            result = cursor.fetchone()
            if result and result['sim'] > 0.7 and (result['any_email'] or result['domain']):
                return {
                    'found': True,
                    'source': 'our_domains_fuzzy',
                    'domain': result.get('best_domain') or result.get('domain'),
                    'emails': self._extract_emails_from_result(result),
                    'has_emails': bool(result['any_email']),
                    'similarity': result['sim']
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error checking domain cache: {e}")
            return None
        finally:
            if conn:
                conn.close()
    
    def check_google_domains_cache(self, employer_name: str) -> Optional[Dict]:
        """
        Check our_google_domains table for cached Google search results
        Returns: Dict with domain info or None
        """
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Check Google domains cache
            cursor.execute("""
                SELECT 
                    gd.website, gd.title, gd.address,
                    ea.name as employer_name
                FROM our_google_domains gd
                LEFT JOIN our_google_domains_our_sql_employment_agency_rel rel 
                    ON rel.our_google_domains_id = gd.id
                LEFT JOIN our_sql_employment_agency ea 
                    ON rel.our_sql_employment_agency_id = ea.id
                WHERE LOWER(ea.name) = LOWER(%s)
                   OR LOWER(gd.title) LIKE LOWER(%s)
                ORDER BY gd.matched_word_count DESC
                LIMIT 1
            """, (employer_name, f'%{employer_name}%'))
            
            result = cursor.fetchone()
            if result and result['website']:
                return {
                    'found': True,
                    'source': 'our_google_domains',
                    'domain': result['website'],
                    'title': result['title'],
                    'address': result['address']
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error checking Google domains cache: {e}")
            return None
        finally:
            if conn:
                conn.close()
    
    def _extract_emails_from_result(self, result: Dict) -> List[str]:
        """Extract unique emails from database result"""
        emails = set()
        
        for field in ['best_email', 'email_impressum', 'email_contact', 'email_jobs']:
            if result.get(field):
                # Handle comma-separated emails
                for email in result[field].split(','):
                    email = email.strip()
                    if email and '@' in email:
                        emails.add(email.lower())
        
        return list(emails)
    
    def save_domain_info(self, employer_name: str, postal_code: str, 
                        domain: str, emails: List[str], source: str = 'google_api'):
        """Save domain information to our_domains table"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Check if entry exists
            cursor.execute("""
                SELECT id FROM our_domains
                WHERE LOWER(the_name) = LOWER(%s) AND zip = %s
            """, (employer_name, postal_code))
            
            existing = cursor.fetchone()
            
            if existing:
                # Update existing
                cursor.execute("""
                    UPDATE our_domains
                    SET domain = COALESCE(domain, %s),
                        best_domain = COALESCE(best_domain, %s),
                        best_email = COALESCE(best_email, %s),
                        source = %s,
                        write_date = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (domain, domain, emails[0] if emails else None, source, existing[0]))
            else:
                # Insert new
                cursor.execute("""
                    INSERT INTO our_domains (
                        the_name, zip, domain, best_domain, 
                        best_email, source, create_date, write_date
                    ) VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, (employer_name, postal_code, domain, domain, 
                      emails[0] if emails else None, source))
            
            conn.commit()
            logger.info(f"Saved domain info for {employer_name}: {domain}")
            
        except Exception as e:
            logger.error(f"Error saving domain info: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                conn.close()


class GoogleSearchQueueProvider:
    """Handles Google search queue for employers without emails"""
    
    def __init__(self):
        self.db_config = DB_CONFIG
        self.daily_limit_usd = 100.0
        self.cost_per_1000 = 5.0
        
    def get_db_connection(self):
        """Get a new database connection"""
        return psycopg2.connect(**self.db_config)
    
    def get_todays_usage(self) -> Dict[str, float]:
        """Get today's Google API usage and cost"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    COUNT(*) as queries_today,
                    COUNT(*) * %s / 1000.0 as cost_today
                FROM our_google_search
                WHERE DATE(create_date) = CURRENT_DATE
            """, (self.cost_per_1000,))
            
            result = cursor.fetchone()
            return {
                'queries': result[0],
                'cost': result[1] or 0.0,
                'remaining_budget': self.daily_limit_usd - (result[1] or 0.0),
                'can_continue': (result[1] or 0.0) < self.daily_limit_usd
            }
            
        except Exception as e:
            logger.error(f"Error getting usage: {e}")
            return {'queries': 0, 'cost': 0.0, 'remaining_budget': self.daily_limit_usd}
        finally:
            if conn:
                conn.close()
    
    def add_to_queue(self, employer_name: str, refnr: str, postal_code: str):
        """Add employer to Google search queue"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Create queue table if not exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS google_search_queue (
                    id SERIAL PRIMARY KEY,
                    employer_name VARCHAR(255),
                    reference_number VARCHAR(50),
                    postal_code VARCHAR(10),
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP,
                    error_message TEXT,
                    UNIQUE(employer_name, postal_code)
                )
            """)
            
            # Insert into queue
            cursor.execute("""
                INSERT INTO google_search_queue (employer_name, reference_number, postal_code)
                VALUES (%s, %s, %s)
                ON CONFLICT (employer_name, postal_code) DO NOTHING
            """, (employer_name, refnr, postal_code))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error adding to queue: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                conn.close()
    
    def get_next_batch(self, batch_size: int = 10) -> List[Dict]:
        """Get next batch of employers to search"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Check budget
            usage = self.get_todays_usage()
            if not usage['can_continue']:
                logger.warning(f"Daily budget reached: ${usage['cost']:.2f}/${self.daily_limit_usd}")
                return []
            
            # Get pending items
            cursor.execute("""
                UPDATE google_search_queue
                SET status = 'processing',
                    processed_at = CURRENT_TIMESTAMP
                WHERE id IN (
                    SELECT id FROM google_search_queue
                    WHERE status = 'pending'
                    ORDER BY created_at
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, employer_name, reference_number, postal_code
            """, (batch_size,))
            
            results = cursor.fetchall()
            conn.commit()
            
            return results
            
        except Exception as e:
            logger.error(f"Error getting batch: {e}")
            if conn:
                conn.rollback()
            return []
        finally:
            if conn:
                conn.close()
    
    def mark_processed(self, queue_id: int, success: bool, error_message: str = None):
        """Mark queue item as processed"""
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE google_search_queue
                SET status = %s,
                    error_message = %s
                WHERE id = %s
            """, ('completed' if success else 'failed', error_message, queue_id))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error marking processed: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                conn.close()