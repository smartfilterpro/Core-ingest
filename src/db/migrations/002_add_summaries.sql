-- ============================================================
-- Migration: 002_add_summaries.sql
-- Purpose: Add daily and regional runtime summaries
-- Author: SmartFilterPro Core Ingest
-- ============================================================

-- 🧩 Table: summaries_daily
-- Stores daily runtime totals, average temperatures, and session stats per device.
CREATE TABLE IF NOT EXISTS summaries_daily (
    id SERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    total_runtime_seconds INTEGER DEFAULT 0,
    avg_session_length_seconds INTEGER DEFAULT 0,
    avg_temp NUMERIC(5,2),
    max_temp NUMERIC(5,2),
    min_temp NUMERIC(5,2),
    session_count INTEGER DEFAULT 0,
    runtime_hours NUMERIC(6,2) GENERATED ALWAYS AS (ROUND(total_runtime_seconds / 3600.0, 2)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT summaries_daily_unique UNIQUE (device_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_summaries_daily_device_date
    ON summaries_daily (device_id, summary_date);

CREATE INDEX IF NOT EXISTS idx_summaries_daily_date
    ON summaries_daily (summary_date);

-- ============================================================

-- 🧩 Table: region_averages
-- Stores average runtime per ZIP prefix and date, computed from summaries_daily.
CREATE TABLE IF NOT EXISTS region_averages (
    id SERIAL PRIMARY KEY,
    zip_prefix VARCHAR(3) NOT NULL,
    summary_date DATE NOT NULL,
    avg_runtime_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT region_avg_unique UNIQUE (zip_prefix, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_region_averages_zip_date
    ON region_averages (zip_prefix, summary_date);

-- ============================================================

-- 🧩 Trigger: Auto-update updated_at timestamp on changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_summaries_daily ON summaries_daily;
CREATE TRIGGER set_updated_at_summaries_daily
BEFORE UPDATE ON summaries_daily
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_region_averages ON region_averages;
CREATE TRIGGER set_updated_at_region_averages
BEFORE UPDATE ON region_averages
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

-- ============================================================

-- 🧩 View: v_summaries_with_region
-- (optional helper view for debugging or Bubble sync previews)
CREATE OR REPLACE VIEW v_summaries_with_region AS
SELECT
    s.device_id,
    s.summary_date,
    s.total_runtime_seconds,
    s.avg_temp,
    s.session_count,
    r.avg_runtime_seconds AS region_avg_runtime
FROM summaries_daily s
LEFT JOIN region_averages r
  ON LEFT((SELECT zip_code FROM devices d WHERE d.device_id = s.device_id LIMIT 1), 3) = r.zip_prefix
  AND s.summary_date = r.summary_date;
