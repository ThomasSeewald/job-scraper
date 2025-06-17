import os
import json
from pathlib import Path

# Load database configuration
config_path = Path(__file__).parent.parent / 'config' / 'database.json'
with open(config_path, 'r') as f:
    db_config = json.load(f)

# Database settings - filter out non-psycopg2 keys
raw_config = db_config['production']
DB_CONFIG = {
    'host': raw_config['host'],
    'port': raw_config['port'],
    'database': raw_config['database'],
    'user': raw_config['user'],
    'password': raw_config['password']
}

# CAPTCHA settings
CAPTCHA_API_KEY = '2946675bf95f4081c1941d7a5f4141b6'  # From independent-captcha-solver.js

# Browser settings
BROWSER_HEADLESS = True  # Default to headless, can be overridden
BROWSER_TIMEOUT = 30000  # 30 seconds

# Scraping settings
DELAY_BETWEEN_REQUESTS = 5000  # 5 seconds - increased to avoid rate limiting
MAX_RETRIES = 2
DELAY_BEFORE_FIRST_REQUEST = 10000  # 10 seconds - wait before first request to appear more human

# Cookie persistence paths
COOKIE_BASE_DIR = Path.home() / '.job-scraper-cookies-python'
COOKIE_BASE_DIR.mkdir(exist_ok=True)