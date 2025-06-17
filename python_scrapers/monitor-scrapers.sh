#!/bin/bash
# Monitor scraper status

echo "========================================="
echo "SCRAPER SYSTEM STATUS"
echo "========================================="
echo ""

# Check running processes
echo "🔄 RUNNING SCRAPERS:"
ps aux | grep -E "(four_window|domains_retry|combined-dashboard)" | grep -v grep | awk '{print "  ✓", $12, $13, $14}'
echo ""

# Check database activity
echo "📊 DATABASE ACTIVITY (Last Hour):"
echo -n "  • Jobs scraped: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM job_scrp_job_details WHERE scraped_at > CURRENT_TIMESTAMP - INTERVAL '1 hour';" | xargs

echo -n "  • Emails found: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM job_scrp_job_details WHERE scraped_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' AND has_emails = true;" | xargs

echo -n "  • Domains retried: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM our_domains_retry_queue WHERE last_retry_at > CURRENT_TIMESTAMP - INTERVAL '1 hour';" | xargs

echo -n "  • New domains added: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM our_domains WHERE source = 'employment_agency' AND create_date > CURRENT_TIMESTAMP - INTERVAL '1 hour';" | xargs
echo ""

# Check queue status
echo "📋 QUEUE STATUS:"
echo -n "  • Retry queue size: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM our_domains_retry_queue WHERE status = 'queued';" | xargs

echo -n "  • High priority retries: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM our_domains_retry_queue WHERE status = 'queued' AND priority <= 3;" | xargs

echo -n "  • Employers pending scraping: "
PGPASSWORD=odoo psql -h localhost -p 5473 -U odoo -d jetzt -t -c "SELECT COUNT(*) FROM job_scrp_employers WHERE email_extraction_attempted = false;" | xargs
echo ""

# Check logs
echo "📝 RECENT LOG ACTIVITY:"
echo "  Four Window Scraper:"
tail -3 four_window_unified.log | sed 's/^/    /'
echo ""
echo "  Domains Retry Scraper:"
tail -3 domains_retry.log 2>/dev/null | sed 's/^/    /' || echo "    [No recent activity]"
echo ""

echo "🌐 DASHBOARD: http://localhost:3001"
echo "🔗 DOMAINS INTEGRATION: http://localhost:3001/domains-integration"
echo ""
echo "========================================="