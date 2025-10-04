// src/db/ensureSchema.ts
import { Pool } from 'pg';

export async function ensureSchema(pool: Pool) {
  console.log('Ensuring database schema...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      device_id TEXT UNIQUE NOT NULL,
      user_id TEXT,
      name TEXT,
      zip_prefix TEXT,
      manufacturer TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS device_status (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      is_reachable BOOLEAN,
      last_active TIMESTAMP,
      last_mode TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS equipment_events (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      event_timestamp TIMESTAMP NOT NULL,
      is_active BOOLEAN,
      equipment_status TEXT,
      temperature_f NUMERIC,
      temperature_c NUMERIC,
      runtime_seconds INT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runtime_sessions (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      start_time TIMESTAMP,
      end_time TIMESTAMP,
      runtime_seconds INT,
      last_mode TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS summaries_daily (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      date DATE NOT NULL,
      runtime_seconds_total INT DEFAULT 0,
      runtime_sessions_count INT DEFAULT 0,
      avg_temperature NUMERIC,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(device_id, date)
    );

    CREATE TABLE IF NOT EXISTS region_averages (
      id SERIAL PRIMARY KEY,
      zip_prefix TEXT NOT NULL,
      date DATE NOT NULL,
      avg_runtime_seconds NUMERIC,
      avg_temp NUMERIC,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(zip_prefix, date)
    );

    CREATE TABLE IF NOT EXISTS filter_resets (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      reset_timestamp TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS device_states (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      state_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
        CREATE TABLE IF NOT EXISTS worker_runs (
      id SERIAL PRIMARY KEY,
      worker_name TEXT NOT NULL,
      started_at TIMESTAMP DEFAULT NOW(),
      finished_at TIMESTAMP,
      duration_seconds NUMERIC,
      success BOOLEAN DEFAULT false,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

  `);

  
  console.log('✅ Database schema ensured');
}
