-- Migration: Add auto_reset_at_115 column to devices table
-- This controls whether filters automatically reset when usage reaches 115%

ALTER TABLE devices ADD COLUMN IF NOT EXISTS auto_reset_at_115 BOOLEAN DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN devices.auto_reset_at_115 IS 'When true, filter automatically resets when usage reaches 115%. Default: true';
