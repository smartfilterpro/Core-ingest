-- Migration 008: Add ecobee_runtime_intervals table
-- Purpose: Store 5-minute interval data from Ecobee Runtime Reports

CREATE TABLE IF NOT EXISTS ecobee_runtime_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  interval_timestamp TIMESTAMPTZ NOT NULL,

  -- Equipment runtime (seconds, 0-300 per 5-min interval)
  aux_heat1_seconds INTEGER DEFAULT 0,
  aux_heat2_seconds INTEGER DEFAULT 0,
  aux_heat3_seconds INTEGER DEFAULT 0,
  comp_cool1_seconds INTEGER DEFAULT 0,
  comp_cool2_seconds INTEGER DEFAULT 0,
  comp_heat1_seconds INTEGER DEFAULT 0,
  comp_heat2_seconds INTEGER DEFAULT 0,
  fan_seconds INTEGER DEFAULT 0,

  -- Telemetry
  outdoor_temp_f NUMERIC(5,2),
  zone_avg_temp_f NUMERIC(5,2),
  zone_humidity INTEGER,
  hvac_mode VARCHAR(20),

  -- Metadata
  data_source VARCHAR(50) DEFAULT 'ecobee_runtime_report',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (device_key, interval_timestamp),
  CONSTRAINT valid_interval_seconds CHECK (
    aux_heat1_seconds BETWEEN 0 AND 300 AND
    aux_heat2_seconds BETWEEN 0 AND 300 AND
    aux_heat3_seconds BETWEEN 0 AND 300 AND
    comp_cool1_seconds BETWEEN 0 AND 300 AND
    comp_cool2_seconds BETWEEN 0 AND 300 AND
    comp_heat1_seconds BETWEEN 0 AND 300 AND
    comp_heat2_seconds BETWEEN 0 AND 300 AND
    fan_seconds BETWEEN 0 AND 300
  )
);

-- Indexes for performance
CREATE INDEX idx_ecobee_intervals_device_date
  ON ecobee_runtime_intervals(device_key, report_date);
CREATE INDEX idx_ecobee_intervals_timestamp
  ON ecobee_runtime_intervals(interval_timestamp);

-- Add comment
COMMENT ON TABLE ecobee_runtime_intervals IS
  'Stores 5-minute interval data from Ecobee Runtime Reports (ground truth)';
