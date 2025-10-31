-- Migration: Add average humidity tracking to region_averages table
-- This enables regional humidity trend analysis alongside temperature and runtime

-- Add avg_humidity column
ALTER TABLE region_averages
ADD COLUMN IF NOT EXISTS avg_humidity NUMERIC;

-- Add comment for documentation
COMMENT ON COLUMN region_averages.avg_humidity IS 'Average humidity (%) across all devices in this region on this date';

-- Backfill avg_humidity from existing summaries_daily data (optional)
-- This will populate historical data if you have it
UPDATE region_averages ra
SET avg_humidity = (
  SELECT AVG(s.avg_humidity)::NUMERIC
  FROM summaries_daily s
  JOIN devices d ON d.device_id = s.device_id
  WHERE d.zip_prefix = ra.region_prefix
    AND s.date = ra.date
    AND d.zip_prefix IS NOT NULL
)
WHERE avg_humidity IS NULL;
