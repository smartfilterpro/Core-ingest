-- Rollback Migration: Remove thermostat mode setting columns from summaries_daily
-- This rolls back migration 002_add_thermostat_mode_breakdown.sql

-- Remove thermostat mode setting runtime columns
ALTER TABLE summaries_daily
DROP COLUMN IF EXISTS runtime_seconds_mode_heat,
DROP COLUMN IF EXISTS runtime_seconds_mode_cool,
DROP COLUMN IF EXISTS runtime_seconds_mode_auto,
DROP COLUMN IF EXISTS runtime_seconds_mode_off,
DROP COLUMN IF EXISTS runtime_seconds_mode_away,
DROP COLUMN IF EXISTS runtime_seconds_mode_eco,
DROP COLUMN IF EXISTS runtime_seconds_mode_other;
