-- ============================================================
-- SmartFilterPro Core Ingest - Schema v1
-- ============================================================
-- All timestamps are stored in UTC
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE users (
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
CREATE TABLE devices (
    device_key           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id         TEXT NOT NULL REFERENCES users(workspace_id) ON DELETE CASCADE,
    device_id            TEXT UNIQUE NOT NULL,
    device_name          TEXT,
    manufacturer         TEXT,
    model                TEXT,
    source               TEXT NOT NULL,        -- ecobee, nest, resideo, etc.
    mac_id               TEXT,
    location_id          TEXT,
    timezone             TEXT,
    zip_code_prefix      VARCHAR(10),
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_devices_workspace ON devices(workspace_id);
CREATE INDEX idx_devices_source ON devices(source);

-- ------------------------------------------------------------
-- DEVICE STATUS (last known snapshot)
-- ------------------------------------------------------------
CREATE TABLE device_status (
    device_key                   UUID PRIMARY KEY REFERENCES devices(device_key) ON DELETE CASCADE,
    frontend_id                  TEXT,
    units                        TEXT,
    is_running                   BOOLEAN,
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
    is_reachable                 BOOLEAN,
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
CREATE TABLE equipment_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    source_event_id     TEXT UNIQUE,
    event_type          TEXT,                 -- heating_on, cooling_off, fan_start, etc.
    equipment_status    TEXT,
    previous_status     TEXT,
    is_active           BOOLEAN,
    session_id          UUID,
    temperature_f       NUMERIC(6,2),
    humidity            NUMERIC(5,2),
    event_data          JSONB,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_equipment_events_device_time ON equipment_events(device_key, recorded_at DESC);

-- ------------------------------------------------------------
-- RUNTIME SESSIONS
-- ------------------------------------------------------------
CREATE TABLE runtime_sessions (
    session_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    mode                TEXT,                     -- heat, cool, fan, unknown
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
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sessions_device_date ON runtime_sessions(device_key, started_at DESC);

-- ------------------------------------------------------------
-- TEMP READINGS
-- ------------------------------------------------------------
CREATE TABLE temp_readings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    session_id          UUID REFERENCES runtime_sessions(session_id) ON DELETE SET NULL,
    event_type          TEXT,
    temperature         NUMERIC(6,2),
    humidity            NUMERIC(5,2),
    setpoint_heat       NUMERIC(6,2),
    setpoint_cool       NUMERIC(6,2),
    outdoor_temperature NUMERIC(6,2),
    units               TEXT,
    recorded_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_temp_device_time ON temp_readings(device_key, recorded_at DESC);

-- ------------------------------------------------------------
-- FILTER RESETS
-- ------------------------------------------------------------
CREATE TABLE filter_resets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key          UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    workspace_id        TEXT NOT NULL,
    reset_ts            TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- DEVICE STATES (for stitcher worker)
-- ------------------------------------------------------------
CREATE TABLE device_states (
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
CREATE TABLE summaries_daily (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key              UUID NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    date                    DATE NOT NULL,
    runtime_seconds_total    INTEGER DEFAULT 0,
    runtime_seconds_cool     INTEGER DEFAULT 0,
    runtime_seconds_heat     INTEGER DEFAULT 0,
    runtime_seconds_fan      INTEGER DEFAULT 0,
    avg_temp_f               NUMERIC(6,2),
    avg_humidity             NUMERIC(5,2),
    avg_outdoor_temp         NUMERIC(6,2),
    hours_used_total         NUMERIC(10,2),
    region_avg_runtime_sec   NUMERIC(10,2),
    created_at               TIMESTAMPTZ DEFAULT now(),
    updated_at               TIMESTAMPTZ DEFAULT now(),
    UNIQUE (device_key, date)
);

CREATE INDEX idx_daily_device_date ON summaries_daily(device_key, date DESC);

-- ------------------------------------------------------------
-- REGION AVERAGES
-- ------------------------------------------------------------
CREATE TABLE region_averages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_group        VARCHAR(10),
    date                DATE,
    avg_runtime_sec     NUMERIC(10,2),
    avg_temp_f          NUMERIC(6,2),
    user_count          INTEGER,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_region_date ON region_averages(region_group, date);

-- ------------------------------------------------------------
-- AUDIT
-- ------------------------------------------------------------
CREATE TABLE ingest_audit (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              TEXT,
    event_count         INTEGER,
    inserted_count      INTEGER,
    duplicates          INTEGER,
    received_at         TIMESTAMPTZ DEFAULT now(),
    note                TEXT
);
