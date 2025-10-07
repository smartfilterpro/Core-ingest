-- Migration to add missing columns to existing schema
-- Run this if you want to keep existing data

-- Add device_id if it doesn't exist (for vendor-specific IDs)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'device_id'
    ) THEN
        ALTER TABLE devices ADD COLUMN device_id TEXT;
        
        -- Populate device_id from device_key as fallback
        UPDATE devices SET device_id = device_key::TEXT WHERE device_id IS NULL;
        
        -- Make it unique
        ALTER TABLE devices ALTER COLUMN device_id SET NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
    END IF;
END $$;

-- Rename 'name' to 'device_name' if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'name'
    ) THEN
        ALTER TABLE devices RENAME COLUMN name TO device_name;
    END IF;
END $$;

-- Add device_name if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'device_name'
    ) THEN
        ALTER TABLE devices ADD COLUMN device_name TEXT;
    END IF;
END $$;

-- Add workspace_id if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'workspace_id'
    ) THEN
        ALTER TABLE devices ADD COLUMN workspace_id TEXT DEFAULT 'default';
        ALTER TABLE devices ALTER COLUMN workspace_id DROP DEFAULT;
    END IF;
END $$;

-- Add source if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'source'
    ) THEN
        ALTER TABLE devices ADD COLUMN source TEXT DEFAULT 'unknown';
    END IF;
END $$;

-- Add connection_source if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'connection_source'
    ) THEN
        ALTER TABLE devices ADD COLUMN connection_source TEXT;
    END IF;
END $$;

-- Add model if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'model'
    ) THEN
        ALTER TABLE devices ADD COLUMN model TEXT;
    END IF;
END $$;

COMMIT;
