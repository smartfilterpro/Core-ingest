/**
 * SmartFilterPro — Core Ingest Admin Schema
 * Ensures database tables and constraints are created for the Core Ingest service.
 */

import { pool } from './pool';

export async function ensureAdminSchema() {
  const client = await pool.connect();
  try {
    console.log('[schema] Ensuring core tables and constraints...');

    // ========== DEVICES ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_key UUID PRIMARY KEY,
        device_id TEXT UNIQUE,
        workspace_id TEXT,
        device_name TEXT,
        manufacturer TEXT,
        model TEXT,
        source TEXT,
        connection_source TEXT,
        zip_code_prefix TEXT,
        timezone TEXT,
        firmware_version TEXT,
        last_mode TEXT,
        last_equipment_status TEXT,
        last_is_cooling BOOLEAN DEFAULT false,
        last_is_heating BOOLEAN DEFAULT false,
        last_is_fan_only BOOLEAN DEFAULT false,
        last_temperature DECIMAL,
        last_humidity DECIMAL,
        last_heat_setpoint DECIMAL,
        last_cool_setpoint DECIMAL,
        use_forced_air_for_heat BOOLEAN DEFAULT false,
        filter_target_hours INTEGER DEFAULT 100,
        filter_usage_percent DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ========== EQUIPMENT_EVENTS ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS equipment_events (
        id UUID PRIMARY KEY,
        device_key UUID REFERENCES devices(device_key) ON DELETE CASCADE,
        source_event_id TEXT,
        event_type TEXT,
        is_active BOOLEAN,
        equipment_status TEXT,
        previous_status TEXT,
        temperature_f DECIMAL,
        temperature_c DECIMAL,
        humidity DECIMAL,
        outdoor_temperature_f DECIMAL,
        outdoor_humidity DECIMAL,
        heat_setpoint_f DECIMAL,
        cool_setpoint_f DECIMAL,
        runtime_seconds INTEGER,
        recorded_at TIMESTAMP DEFAULT NOW(),
        source_vendor TEXT,
        payload_raw JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ✅ Ensure dedupe safety
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'unique_device_event'
        ) THEN
          ALTER TABLE equipment_events
          ADD CONSTRAINT unique_device_event UNIQUE (device_key, source_event_id);
        END IF;
      END
      $$;
    `);

    // ✅ Improve performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_equipment_events_device_event
      ON equipment_events (device_key, recorded_at DESC);
    `);

    // ========== SUMMARIES_DAILY ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS summaries_daily (
        id UUID PRIMARY KEY,
        device_key UUID REFERENCES devices(device_key) ON DELETE CASCADE,
        summary_date DATE,
        total_runtime_seconds INTEGER DEFAULT 0,
        total_cooling_seconds INTEGER DEFAULT 0,
        total_heating_seconds INTEGER DEFAULT 0,
        total_fan_seconds INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ========== REGION_AVERAGES ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS region_averages (
        region_prefix TEXT PRIMARY KEY,
        avg_runtime_seconds INTEGER DEFAULT 0,
        avg_filter_life_percent DECIMAL(5,2) DEFAULT 0,
        sample_size INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ========== DEVICE_STATES (optional historical log) ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_states (
        id UUID PRIMARY KEY,
        device_key UUID REFERENCES devices(device_key) ON DELETE CASCADE,
        state JSONB,
        recorded_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('[schema] ✅ All core tables and indexes ensured.');
    console.log('[schema] No schema change required for OFF resets — handled in ingest logic.');
  } catch (err: any) {
    console.error('[schema] ❌ Error ensuring schema:', err.message);
  } finally {
    client.release();
  }
}