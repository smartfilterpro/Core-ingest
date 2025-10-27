-- Migration: Add filter-specific hours tracking to device_states table
-- This enables separate tracking of filter-relevant runtime hours based on use_forced_air_for_heat logic

-- Add filter_hours_used column to track runtime that counts toward filter usage
ALTER TABLE device_states
ADD COLUMN IF NOT EXISTS filter_hours_used NUMERIC DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN device_states.filter_hours_used IS 'Cumulative runtime hours that count toward filter usage (respects use_forced_air_for_heat setting)';

-- Initialize filter_hours_used to match hours_used_total for existing devices
-- (assuming all existing runtime counted toward filter before this feature)
UPDATE device_states
SET filter_hours_used = COALESCE(hours_used_total, 0)
WHERE filter_hours_used IS NULL OR filter_hours_used = 0;
