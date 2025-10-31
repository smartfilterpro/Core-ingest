-- Migration: Add unique constraint to region_averages for UPSERT functionality
-- This allows ON CONFLICT (region_prefix, date) to work properly

-- Add unique constraint
ALTER TABLE region_averages
ADD CONSTRAINT region_averages_region_date_unique
UNIQUE (region_prefix, date);

-- Add comment for documentation
COMMENT ON CONSTRAINT region_averages_region_date_unique ON region_averages IS
  'Ensures one row per region per date, enables UPSERT in regionAggregationWorker';
