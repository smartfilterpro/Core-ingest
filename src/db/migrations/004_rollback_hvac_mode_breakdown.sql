-- Rollback Migration: Remove HVAC mode breakdown columns from summaries_daily
-- This rolls back migration 001_add_mode_breakdown_to_summaries.sql

-- Remove HVAC mode-specific runtime columns
ALTER TABLE summaries_daily
DROP COLUMN IF EXISTS runtime_seconds_heat,
DROP COLUMN IF EXISTS runtime_seconds_cool,
DROP COLUMN IF EXISTS runtime_seconds_fan,
DROP COLUMN IF EXISTS runtime_seconds_auxheat,
DROP COLUMN IF EXISTS runtime_seconds_unknown;
