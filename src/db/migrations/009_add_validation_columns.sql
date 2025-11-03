-- Migration 009: Add validation columns to summaries_daily
-- Purpose: Store validated runtime from Ecobee reports and track discrepancies

ALTER TABLE summaries_daily
  ADD COLUMN IF NOT EXISTS validated_runtime_seconds_total INTEGER,
  ADD COLUMN IF NOT EXISTS validated_runtime_seconds_heat INTEGER,
  ADD COLUMN IF NOT EXISTS validated_runtime_seconds_cool INTEGER,
  ADD COLUMN IF NOT EXISTS validated_runtime_seconds_auxheat INTEGER,
  ADD COLUMN IF NOT EXISTS validated_runtime_seconds_fan INTEGER,
  ADD COLUMN IF NOT EXISTS validation_source VARCHAR(50),
  ADD COLUMN IF NOT EXISTS validation_interval_count INTEGER,
  ADD COLUMN IF NOT EXISTS validation_coverage_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS validation_discrepancy_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS validation_performed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_corrected BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

-- Indexes for querying validated summaries
CREATE INDEX IF NOT EXISTS idx_summaries_validation_source
  ON summaries_daily(validation_source)
  WHERE validation_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_summaries_corrected
  ON summaries_daily(is_corrected)
  WHERE is_corrected = TRUE;

-- Add comments
COMMENT ON COLUMN summaries_daily.validated_runtime_seconds_total IS
  'Runtime total from Ecobee Runtime Report (ground truth)';
COMMENT ON COLUMN summaries_daily.validation_discrepancy_seconds IS
  'Difference between calculated and validated runtime (absolute value)';
COMMENT ON COLUMN summaries_daily.is_corrected IS
  'TRUE if discrepancy > 300 seconds (5 minutes)';
