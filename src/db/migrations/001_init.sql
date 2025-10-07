-- ============================================================
-- SmartFilterPro Core Ingest - Schema v1 (Clean)
-- ============================================================
-- All timestamps are stored in UTC
-- Uses device_key (UUID) consistently throughout
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id         TEXT UNIQUE NOT NULL,
    zip_code_prefix      VARCHAR(10),
    region_group         VARCHAR(10) GENERATED ALWAYS AS (
        CASE
            WHEN zip_code_prefix IS NULL THEN NULL
            WHEN length(zip_code_prefix) >= 3 THEN substr(zip_code_prefix, 1, 3) || '**'
            ELSE zip_code_prefix
        END
    ) STORED,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- DEVICES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    device_key                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id                TEXT NOT NULL REFERENCES users(workspace_id) ON DELETE CASCADE,
    device_id                   TEXT UNIQUE NOT NULL,  -- vendor-specific ID (nest:abc, ecobee:123)
    device_name                 TEXT,
    manufacturer                TEXT,
    model                       TEXT,
    device_type                 TEXT DEFAULT 'thermostat',
    source                      TEXT NOT NULL,  -- nest, ecobee, resideo, etc.
    connection_source           TEXT,
    mac_id                      TEXT,
    location_id                 TEXT,
    timezone                    TEXT,
    zip_code_prefix             VARCHAR(10),
    firmware_version            TEXT,
    serial_number               TEXT,
    ip_address                  TEXT,
    use_forced_air_for_heat     BOOLEAN DEFAULT TRUE,
    filter_target_hours         INTEGER DEFAULT 100,
    filter_usage_percent        DECIMAL(5,2) DEFAULT 0,
    last_mode                   TEXT,
    last_equipment_status       TEXT,
    last_is_cooling             BOOLEAN DEFAULT FALSE,
    last_is_heating             BOOLEAN DEFAULT FALSE,
    last_is_fan_only            BOOLEAN DEFAULT FALSE,
    last_temperature            NUMERIC(6,2),
    last_humidity               NUMERIC(5,2),
    last_heat_setpoint          NUMERIC(6,2),
    last_cool_setpoint          NUMERIC(6,2),
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_workspace ON devices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_devices_source ON devices(source);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

-- ------------------------------------------------------------
-- DEVICE STATUS (last known snapshot)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_status (
    device_key                   UUID PRIMARY KEY REFERENCES devices(device_key) ON DELETE CASCADE,
    frontend_id                  TEXT,
    units                        TEXT,
    is_running                   BOOLEAN DEFAULT FALSE,
    session_started_at           TIMESTAMPTZ,
    current_mode                 TEXT,
    current_equipment_status     TEXT,
    last_temperature             NUMERIC(6,2),
    last_heat_setpoint           NUMERIC(6,2),
    last_cool_setpoint           NUMERIC(6,2),
    last_fan_status              TEXT,
    last_equipment_status        TEXT,
    last_mode                    TEXT,
    last_was_cooling             BOOLEAN,
    last_was_heating             BOOLEAN,
    last_was_fan_only            BOOLEAN,
    indoor_humidity              NUMERIC(5,2),
    outdoor_temperature          NUMERIC(6,2),
    outdoor_humidity             NUMERIC(5,2),
    battery_level                NUMERIC(5,2),
    firmware_version             TEXT,
    is_reachable                 BOOLEAN DEFAULT TRUE,
    is_online                    BOOLEAN,
    last_seen_at                 TIMESTAMPTZ,
    last_activity_at             TIMESTAMPTZ,
    last_post_at                 TIMESTAMPTZ,
    last_staleness_notification  TIMESTAMPTZ,
    room_display_name            TEXT,
    last_fan_tail_until          TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ DEFAULT now(),
    updated_at                   TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- EQUIPMENT EVENTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_events (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key              UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    source_event_id         TEXT UNIQUE,
    event_type              TEXT,
    equipment_status        TEXT,
    previous_status         TEXT,
    is_active               BOOLEAN,
    session_id              UUID,
    temperature_f           NUMERIC(6,2),
    temperature_c           NUMERIC(6,2),
    humidity                NUMERIC(5,2),
    outdoor_temperature_f   NUMERIC(6,2),
    outdoor_humidity        NUMERIC(5,2),
    pressure_hpa            NUMERIC(6,2),
    heat_setpoint_f         NUMERIC(6,2),
    cool_setpoint_f         NUMERIC(6,2),
    target_humidity         NUMERIC(5,2),
    runtime_seconds         INTEGER,
    event_data              JSONB,
    payload_raw             JSONB,
    source_vendor           TEXT,
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_events_device_time ON equipment_events(device_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_events_source_id ON equipment_events(source_event_id);

-- ------------------------------------------------------------
-- RUNTIME SESSIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runtime_sessions (
    session_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    mode                TEXT,
    equipment_status    TEXT,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    duration_seconds    INTEGER,
    start_temperature   NUMERIC(6,2),
    end_temperature     NUMERIC(6,2),
    heat_setpoint       NUMERIC(6,2),
    cool_setpoint       NUMERIC(6,2),
    outdoor_avg_temp    NUMERIC(6,2),
    outdoor_degree_hours NUMERIC(6,2),
    energy_est_kwh      NUMERIC(8,3),
    tick_count          INTEGER,
    last_tick_at        TIMESTAMPTZ,
    terminated_reason   TEXT,
    is_counted          BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_device_date ON runtime_sessions(device_key, started_at DESC);

-- ------------------------------------------------------------
-- DEVICE STATES (for session stitcher worker)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_states (
    device_key          UUID PRIMARY KEY REFERENCES devices(device_key) ON DELETE CASCADE,
    last_event_ts       TIMESTAMPTZ,
    open_session_id     UUID REFERENCES runtime_sessions(session_id) ON DELETE SET NULL,
    is_active           BOOLEAN DEFAULT false,
    hours_used_total    NUMERIC(10,2) DEFAULT 0,
    last_reset_ts       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- DAILY SUMMARIES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS summaries_daily (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key                  UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    date                        DATE NOT NULL,
    runtime_seconds_total       INTEGER DEFAULT 0,
    runtime_seconds_cool        INTEGER DEFAULT 0,
    runtime_seconds_heat        INTEGER DEFAULT 0,
    runtime_seconds_fan         INTEGER DEFAULT 0,
    runtime_sessions_count      INTEGER DEFAULT 0,
    avg_temp_f                  NUMERIC(6,2),
    avg_humidity                NUMERIC(5,2),
    avg_outdoor_temp            NUMERIC(6,2),
    hours_used_total            NUMERIC(10,2),
    region_avg_runtime_sec      NUMERIC(10,2),
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (device_key, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_device_date ON summaries_daily(device_key, date DESC);

-- ------------------------------------------------------------
-- HOURLY SUMMARIES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS summaries_hourly (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key              UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    summary_hour            TIMESTAMP NOT NULL,
    runtime_seconds_total   INTEGER DEFAULT 0,
    avg_temp_f              NUMERIC(6,2),
    max_temp_f              NUMERIC(6,2),
    min_temp_f              NUMERIC(6,2),
    session_count           INTEGER DEFAULT 0,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (device_key, summary_hour)
);

CREATE INDEX IF NOT EXISTS idx_hourly_device_hour ON summaries_hourly(device_key, summary_hour DESC);

-- ------------------------------------------------------------
-- REGION AVERAGES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_averages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_group        VARCHAR(10),
    zip_prefix          VARCHAR(3),
    date                DATE,
    avg_runtime_sec     NUMERIC(10,2),
    avg_temp_f          NUMERIC(6,2),
    device_count        INTEGER,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (zip_prefix, date)
);

CREATE INDEX IF NOT EXISTS idx_region_date ON region_averages(zip_prefix, date DESC);

-- ------------------------------------------------------------
-- FILTER RESETS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filter_resets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    workspace_id        TEXT NOT NULL,
    user_id             UUID,
    reset_ts            TIMESTAMPTZ DEFAULT now(),
    source              VARCHAR(50) DEFAULT 'manual',
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filter_resets_device ON filter_resets(device_key);
CREATE INDEX IF NOT EXISTS idx_filter_resets_ts ON filter_resets(reset_ts DESC);

-- ------------------------------------------------------------
-- WORKER RUNS (for logging)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_runs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_name         TEXT NOT NULL,
    status              TEXT DEFAULT 'running',
    started_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    duration_seconds    NUMERIC(10,2),
    success             BOOLEAN DEFAULT false,
    devices_processed   INTEGER,
    success_count       INTEGER,
    fail_count          INTEGER,
    error_message       TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_runs_name ON worker_runs(worker_name);
CREATE INDEX IF NOT EXISTS idx_worker_runs_started ON worker_runs(started_at DESC);

-- ------------------------------------------------------------
-- INGEST AUDIT
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_audit (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              TEXT,
    event_count         INTEGER,
    inserted_count      INTEGER,
    duplicates          INTEGER,
    received_at         TIMESTAMPTZ DEFAULT now(),
    note                TEXT
);

-- ------------------------------------------------------------
-- AUTO-UPDATE TRIGGERS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_device_status_updated_at BEFORE UPDATE ON device_status
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_runtime_sessions_updated_at BEFORE UPDATE ON runtime_sessions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_summaries_daily_updated_at BEFORE UPDATE ON summaries_daily
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_summaries_hourly_updated_at BEFORE UPDATE ON summaries_hourly
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER update_device_states_updated_at BEFORE UPDATE ON device_states
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
