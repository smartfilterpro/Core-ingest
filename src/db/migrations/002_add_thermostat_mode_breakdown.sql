-- Migration: Add thermostat mode setting columns to summaries_daily table
-- This enables Operating Mode Distribution (what users SET thermostat to)

-- Add thermostat mode setting runtime columns
ALTER TABLE summaries_daily
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_heat INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_cool INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_auto INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_off INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_away INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_eco INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS runtime_seconds_mode_other INTEGER DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_heat IS 'Total runtime when thermostat was set to HEAT mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_cool IS 'Total runtime when thermostat was set to COOL mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_auto IS 'Total runtime when thermostat was set to AUTO/HEAT-COOL mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_off IS 'Total runtime when thermostat was set to OFF mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_away IS 'Total runtime when thermostat was set to AWAY/VACATION mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_eco IS 'Total runtime when thermostat was set to ECO/ENERGY_SAVER mode (seconds)';
COMMENT ON COLUMN summaries_daily.runtime_seconds_mode_other IS 'Total runtime when thermostat was in other/unknown mode setting (seconds)';
