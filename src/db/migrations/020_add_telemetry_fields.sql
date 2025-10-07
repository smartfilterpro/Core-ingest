-- Extend devices table
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS connection_source TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'thermostat',
  ADD COLUMN IF NOT EXISTS firmware_version TEXT,
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Extend equipment_events for full telemetry
ALTER TABLE equipment_events
  ADD COLUMN IF NOT EXISTS humidity NUMERIC,
  ADD COLUMN IF NOT EXISTS outdoor_temperature_f NUMERIC,
  ADD COLUMN IF NOT EXISTS outdoor_humidity NUMERIC,
  ADD COLUMN IF NOT EXISTS pressure_hpa NUMERIC,
  ADD COLUMN IF NOT EXISTS heat_setpoint_f NUMERIC,
  ADD COLUMN IF NOT EXISTS cool_setpoint_f NUMERIC,
  ADD COLUMN IF NOT EXISTS target_humidity NUMERIC,
  ADD COLUMN IF NOT EXISTS payload_raw JSONB;
