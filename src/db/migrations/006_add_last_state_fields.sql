-- 006_add_last_state_fields.sql
-- Ensure last-state tracking columns exist in device_status

ALTER TABLE device_status
  ADD COLUMN IF NOT EXISTS last_mode TEXT,
  ADD COLUMN IF NOT EXISTS last_is_cooling BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_is_heating BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_is_fan_only BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_equipment_status TEXT;

COMMENT ON COLUMN device_status.last_mode IS 'Last thermostat mode (HEAT, COOL, OFF, etc.)';
COMMENT ON COLUMN device_status.last_is_cooling IS 'Whether last known state was cooling';
COMMENT ON COLUMN device_status.last_is_heating IS 'Whether last known state was heating';
COMMENT ON COLUMN device_status.last_is_fan_only IS 'Whether last known state was fan only';
COMMENT ON COLUMN device_status.last_equipment_status IS 'Last equipment status reported by the device';
