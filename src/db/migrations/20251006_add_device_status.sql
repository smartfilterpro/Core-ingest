-- Migration: Ensure device_status table and state tracking fields exist in Core Ingest
-- Author: Eric Hanfman (SmartFilterPro)
-- Date: 2025-10-06

CREATE TABLE IF NOT EXISTS device_status (
  id SERIAL PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT,
  user_id TEXT,
  workspace_id TEXT,
  is_running BOOLEAN DEFAULT FALSE,
  current_equipment_status TEXT,
  last_equipment_status TEXT,
  last_mode TEXT,
  last_is_cooling BOOLEAN DEFAULT FALSE,
  last_is_heating BOOLEAN DEFAULT FALSE,
  last_is_fan_only BOOLEAN DEFAULT FALSE,
  is_reachable BOOLEAN DEFAULT TRUE,
  use_forced_air_for_heat BOOLEAN DEFAULT TRUE,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  runtime_seconds INTEGER DEFAULT 0,
  last_update_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure new columns exist for AI and runtime tracking
ALTER TABLE device_status
  ADD COLUMN IF NOT EXISTS filter_target_hours INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS filter_usage_percent DECIMAL(5,2) DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_device_status_device_id ON device_status(device_id);
CREATE INDEX IF NOT EXISTS idx_device_status_user_id ON device_status(user_id);
CREATE INDEX IF NOT EXISTS idx_device_status_workspace_id ON device_status(workspace_id);
CREATE INDEX IF NOT EXISTS idx_device_status_is_running ON device_status(is_running);
