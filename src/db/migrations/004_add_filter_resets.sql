-- ============================================================
-- Migration: 004_add_filter_resets.sql
-- Purpose: Store filter reset events (manual or automatic)
-- Author: SmartFilterPro Core Ingest
-- ============================================================

CREATE TABLE IF NOT EXISTS filter_resets (
    id SERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    user_id UUID,
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'manual',          -- e.g. manual, bubble, vendor, ai
    notes TEXT,                                   -- optional description
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filter_resets_device_id
    ON filter_resets (device_id);

CREATE INDEX IF NOT EXISTS idx_filter_resets_triggered_at
    ON filter_resets (triggered_at DESC);

-- ============================================================
-- Trigger to auto-update updated_at on changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_filter_resets ON filter_resets;
CREATE TRIGGER set_updated_at_filter_resets
BEFORE UPDATE ON filter_resets
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- View: v_filter_resets_detailed
-- Shows joined data for filter resets + devices for debugging
CREATE OR REPLACE VIEW v_filter_resets_detailed AS
SELECT
  f.id,
  f.device_id,
  d.device_name,
  f.user_id,
  f.source,
  f.triggered_at,
  f.notes
FROM filter_resets f
LEFT JOIN devices d ON f.device_id = d.device_id
ORDER BY f.triggered_at DESC;
