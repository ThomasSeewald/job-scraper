-- Fix the get_next_retry_batch function with correct data types

DROP FUNCTION IF EXISTS get_next_retry_batch(INTEGER);

CREATE OR REPLACE FUNCTION get_next_retry_batch(batch_size INTEGER DEFAULT 50)
RETURNS TABLE (
    queue_id INTEGER,
    domain_id INTEGER,
    domain_url VARCHAR(255),  -- Changed from TEXT to match table
    retry_category VARCHAR(50),  -- Changed from TEXT to match table
    original_error TEXT,
    retry_attempts INTEGER
) AS $$
BEGIN
    RETURN QUERY
    UPDATE our_domains_retry_queue 
    SET status = 'processing',
        last_retry_at = CURRENT_TIMESTAMP,
        retry_attempts = our_domains_retry_queue.retry_attempts + 1
    WHERE id IN (
        SELECT q.id 
        FROM our_domains_retry_queue q
        WHERE q.status = 'queued' 
            AND q.retry_attempts < q.max_retries
            AND (q.next_retry_at IS NULL OR q.next_retry_at <= CURRENT_TIMESTAMP)
        ORDER BY q.priority ASC, q.created_at ASC
        LIMIT batch_size
    )
    RETURNING 
        id,
        our_domains_retry_queue.domain_id,
        our_domains_retry_queue.domain_url,
        our_domains_retry_queue.retry_category,
        our_domains_retry_queue.original_error,
        our_domains_retry_queue.retry_attempts;
END;
$$ LANGUAGE plpgsql;