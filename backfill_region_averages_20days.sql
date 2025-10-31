-- Backfill region_averages for last 20 days
-- Run this in Railway PostgreSQL console

WITH recent AS (
  SELECT
    d.zip_prefix,
    s.date,
    AVG(s.runtime_seconds_total)::NUMERIC AS avg_runtime_seconds,
    AVG(s.avg_temperature)::NUMERIC AS avg_temperature,
    AVG(s.avg_humidity)::NUMERIC AS avg_humidity,
    COUNT(DISTINCT s.device_id) AS device_count
  FROM summaries_daily s
  JOIN devices d ON d.device_id = s.device_id
  WHERE s.date >= CURRENT_DATE - INTERVAL '20 days'
    AND d.zip_prefix IS NOT NULL
  GROUP BY d.zip_prefix, s.date
)
INSERT INTO region_averages (
  region_prefix,
  date,
  avg_runtime_seconds,
  avg_temp,
  avg_humidity,
  sample_size,
  updated_at
)
SELECT
  r.zip_prefix,
  r.date,
  r.avg_runtime_seconds,
  r.avg_temperature,
  r.avg_humidity,
  r.device_count,
  NOW()
FROM recent r
ON CONFLICT (region_prefix, date)
DO UPDATE SET
  avg_runtime_seconds = EXCLUDED.avg_runtime_seconds,
  avg_temp = EXCLUDED.avg_temp,
  avg_humidity = EXCLUDED.avg_humidity,
  sample_size = EXCLUDED.sample_size,
  updated_at = NOW();

-- Verify the backfill
SELECT
  region_prefix,
  COUNT(*) as days_filled,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM region_averages
WHERE date >= CURRENT_DATE - INTERVAL '20 days'
GROUP BY region_prefix
ORDER BY region_prefix;
