# Parallel Workers Guide

## Cookie Isolation

Each worker instance automatically gets its own cookie directory to prevent conflicts:

```
~/.job-scraper-cookies-python/
├── newest-jobs-12345-1234567890-5678/     # Worker 1
├── newest-jobs-12346-1234567891-9012/     # Worker 2
└── historical-employer-12347-1234567892-3456/  # Worker 3
```

## Running Multiple Workers

### Method 1: Different Process IDs (Automatic)
```bash
# Terminal 1
python3 newest_jobs_scraper.py 10

# Terminal 2  
python3 newest_jobs_scraper.py 10

# Terminal 3
python3 historical_employer_scraper.py 5
```
Each will automatically get a unique process ID.

### Method 2: Explicit Process IDs
```python
# In your code
scraper1 = NewestJobsScraper(process_id="worker-1")
scraper2 = NewestJobsScraper(process_id="worker-2")
```

### Method 3: Using GNU Parallel
```bash
# Run 3 parallel instances
parallel -j 3 python3 newest_jobs_scraper.py 10 ::: 1 2 3
```

### Method 4: Using tmux/screen
```bash
# Create multiple tmux sessions
tmux new-session -d -s worker1 'python3 newest_jobs_scraper.py 10'
tmux new-session -d -s worker2 'python3 newest_jobs_scraper.py 10'
tmux new-session -d -s worker3 'python3 historical_employer_scraper.py 5'
```

## Cookie Sharing Strategy

For maximum efficiency with CAPTCHA solving:

1. **First Run**: One worker solves CAPTCHA and saves cookies
2. **Share Cookies**: Copy the cookie directory to other workers
3. **Parallel Processing**: All workers can now access jobs without CAPTCHA

```bash
# After first worker solves CAPTCHA
COOKIE_DIR=$(ls -d ~/.job-scraper-cookies-python/newest-jobs-* | head -1)

# Copy to other workers (example)
cp -r "$COOKIE_DIR" ~/.job-scraper-cookies-python/newest-jobs-worker2/
cp -r "$COOKIE_DIR" ~/.job-scraper-cookies-python/newest-jobs-worker3/
```

## Best Practices

1. **Resource Management**: Limit concurrent workers to avoid overwhelming the server
   - Recommended: 2-3 workers maximum
   - Add delays between requests

2. **Database Locks**: Workers coordinate through database to avoid duplicate work
   - Jobs are marked as processed
   - Employers are marked when email extraction is attempted

3. **Error Handling**: Each worker handles its own errors independently
   - Failed jobs can be retried by other workers
   - Cookie corruption in one worker doesn't affect others

4. **Monitoring**: Check worker-specific logs
   ```bash
   # Each worker creates its own log entries
   tail -f logs/cron-detail-scraper.log | grep "worker-1"
   ```

## Example: Production Setup

```bash
#!/bin/bash
# run-parallel-scrapers.sh

# Clean old cookie directories older than 7 days
find ~/.job-scraper-cookies-python -type d -mtime +7 -exec rm -rf {} \;

# Start workers with different configurations
python3 newest_jobs_scraper.py 20 &  # Fast worker for new jobs
PID1=$!

sleep 5  # Stagger start times

python3 newest_jobs_scraper.py 20 &  # Second worker
PID2=$!

sleep 5

python3 historical_employer_scraper.py 10 &  # Slow worker for historical
PID3=$!

# Wait for all workers
wait $PID1 $PID2 $PID3
echo "All workers completed"
```

## Troubleshooting

### Issue: Workers getting CAPTCHAs repeatedly
- **Cause**: Each worker has its own cookie directory
- **Solution**: Share cookies after first CAPTCHA solve

### Issue: Database conflicts
- **Cause**: Multiple workers trying to update same record
- **Solution**: Built-in retry logic handles this automatically

### Issue: Too many browser instances
- **Cause**: Workers not cleaning up properly
- **Solution**: Use process managers like supervisor or systemd

### Issue: Cookie directory grows too large
- **Cause**: Old cookie directories not cleaned
- **Solution**: Periodic cleanup with cron job
  ```bash
  # Add to crontab
  0 0 * * * find ~/.job-scraper-cookies-python -type d -mtime +7 -exec rm -rf {} \;
  ```