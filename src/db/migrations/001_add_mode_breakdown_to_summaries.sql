-- Migration: Add mode breakdown columns to summaries_daily table
-- This enables HVAC mode breakdown (cooling, heating, fan, aux heat)

-- Add mode-specific runtime columns
ALTER TABLE summaries_daily
ADD COLUMN IF NOT EXISTS runtime_seconds_heat INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_cool INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_fan INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_auxheat INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_unknown INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN summaries_daily.runtime_seconds_heat IS 'Total runtime in heating mode for this day (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_cool IS 'Total runtime in cooling mode for this day (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_fan IS 'Total runtime in fan-only mode for this day (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_auxheat IS 'Total runtime in auxiliary/emergency heat mode for this day (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_unknown IS 'Total runtime in unknown mode for this day (seconds)';