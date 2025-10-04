-- ============================================================
-- Migration: 003_add_hourly_summaries.sql
-- Purpose: Add hourly runtime summaries per device
-- Author: SmartFilterPro Core Ingest
-- ============================================================

CREATE TABLE IF NOT EXISTS summaries_hourly (
    id SERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    summary_hour TIMESTAMP WITHOUT TIME ZONE NOT NULL, -- truncated to hour boundary
    total_runtime_seconds INTEGER DEFAULT 0,
    avg_temp NUMERIC(5,2),
    max_temp NUMERIC(5,2),
    min_temp NUMERIC(5,2),
    session_count INTEGER DEFAULT 0,
    runtime_hours NUMERIC(6,2) GENERATED ALWAYS AS (ROUND(total_runtime_seconds / 3600.0, 2)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT summaries_hourly_unique UNIQUE (device_id, summary_hour)
);

CREATE INDEX IF NOT EXISTS idx_summaries_hourly_device_hour
    ON summaries_hourly (device_id, summary_hour);

CREATE INDEX IF NOT EXISTS idx_summaries_hourly_hour
    ON summaries_hourly (summary_hour);

-- ============================================================

-- 🧩 Trigger: Auto-update updated_at timestamp
DROP TRIGGER IF EXISTS set_updated_at_summaries_hourly ON summaries_hourly;
CREATE TRIGGER set_updated_at_summaries_hourly
BEFORE UPDATE ON summaries_hourly
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();
