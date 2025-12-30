-- Migration 011: Add user metrics tracking tables
-- Purpose: Track global historical user data - users added per day and users who leave per day

-- Table 1: Track individual user deletions for accurate historical data
CREATE TABLE IF NOT EXISTS user_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_date DATE NOT NULL DEFAULT CURRENT_DATE,
  device_count INTEGER NOT NULL DEFAULT 0,
  workspace_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_deletions
CREATE INDEX idx_user_deletions_date ON user_deletions(deleted_date);
CREATE INDEX idx_user_deletions_user_id ON user_deletions(user_id);

-- Table 2: Daily aggregated user metrics
CREATE TABLE IF NOT EXISTS user_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,

  -- User counts for this day
  users_added INTEGER NOT NULL DEFAULT 0,
  users_deleted INTEGER NOT NULL DEFAULT 0,

  -- Cumulative totals (snapshot at end of day)
  total_users INTEGER NOT NULL DEFAULT 0,
  total_devices INTEGER NOT NULL DEFAULT 0,
  active_users_24h INTEGER NOT NULL DEFAULT 0,

  -- Net change
  net_user_change INTEGER GENERATED ALWAYS AS (users_added - users_deleted) STORED,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient date range queries
CREATE INDEX idx_user_metrics_daily_date ON user_metrics_daily(date DESC);

-- Comments
COMMENT ON TABLE user_deletions IS 'Tracks individual user deletions for historical metrics';
COMMENT ON TABLE user_metrics_daily IS 'Daily aggregated user metrics - users added, deleted, and totals';
COMMENT ON COLUMN user_metrics_daily.users_added IS 'Number of new users whose first device was created on this date';
COMMENT ON COLUMN user_metrics_daily.users_deleted IS 'Number of users deleted on this date';
COMMENT ON COLUMN user_metrics_daily.net_user_change IS 'Net change in users (added - deleted)';
