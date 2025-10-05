-- 005_add_ai_fields.sql
-- Adds fields needed for AI + Bubble integration

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS filter_target_hours INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS filter_usage_percent DECIMAL(5,2) DEFAULT 0;

ALTER TABLE device_status
  ADD COLUMN IF NOT EXISTS is_reachable BOOLEAN DEFAULT true;
