-- ============================================================================
-- CLEANUP SCRIPT: Remove Phantom Runtime Sessions
-- ============================================================================
--
-- PURPOSE: Remove sessions created by Session Stitcher tail_close logic
--          that have unrealistic durations (>2 hours) due to polling gaps
--
-- CAUSE: When Ecobee polling stopped for hours/days, Session Stitcher
--        created sessions spanning the entire gap, e.g., 19-hour "sessions"
--
-- IMPACT: Summaries show 47+ hours of runtime when actual is ~4 hours
--
-- DATE: 2025-11-04
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: BACKUP (Optional but recommended)
-- ============================================================================

-- Create backup table
CREATE TABLE IF NOT EXISTS runtime_sessions_backup_20251104 AS
SELECT * FROM runtime_sessions
WHERE started_at >= '2025-10-28'
  AND terminated_reason = 'tail_close'
  AND runtime_seconds > 7200;  -- Sessions > 2 hours

-- Verify backup
SELECT
  COUNT(*) as backed_up_sessions,
  ROUND((SUM(runtime_seconds) / 3600.0)::numeric, 2) as backed_up_hours
FROM runtime_sessions_backup_20251104;

-- ============================================================================
-- STEP 2: IDENTIFY AFFECTED DEVICES
-- ============================================================================

-- Show all devices with phantom sessions
SELECT
  device_key,
  COUNT(*) as phantom_sessions,
  ROUND((SUM(runtime_seconds) / 3600.0)::numeric, 2) as phantom_hours,
  MAX(runtime_seconds) as max_session_seconds,
  ROUND((MAX(runtime_seconds) / 3600.0)::numeric, 2) as max_session_hours,
  ARRAY_AGG(session_id) as session_ids
FROM runtime_sessions
WHERE started_at >= '2025-10-28'
  AND terminated_reason = 'tail_close'
  AND runtime_seconds > 7200  -- > 2 hours = phantom
GROUP BY device_key
ORDER BY phantom_hours DESC;

-- ============================================================================
-- STEP 3: SHOW PHANTOM SESSIONS (FOR REVIEW)
-- ============================================================================

-- List all phantom sessions before deletion
SELECT
  session_id,
  device_key,
  equipment_status,
  runtime_seconds,
  ROUND((runtime_seconds / 3600.0)::numeric, 2) as runtime_hours,
  started_at,
  ended_at,
  terminated_reason,
  created_at
FROM runtime_sessions
WHERE started_at >= '2025-10-28'
  AND terminated_reason = 'tail_close'
  AND runtime_seconds > 7200
ORDER BY runtime_seconds DESC;

-- ============================================================================
-- STEP 4: DELETE PHANTOM SESSIONS
-- ============================================================================

-- Delete sessions with unrealistic durations (>2 hours)
DELETE FROM runtime_sessions
WHERE started_at >= '2025-10-28'
  AND terminated_reason = 'tail_close'
  AND runtime_seconds > 7200
RETURNING
  session_id,
  device_key,
  ROUND((runtime_seconds / 3600.0)::numeric, 2) as deleted_hours;

-- Verify deletion
SELECT
  terminated_reason,
  COUNT(*) as remaining_sessions,
  ROUND((SUM(runtime_seconds) / 3600.0)::numeric, 2) as remaining_hours
FROM runtime_sessions
WHERE started_at >= '2025-10-28'
GROUP BY terminated_reason
ORDER BY terminated_reason;

-- ============================================================================
-- STEP 5: DELETE INCORRECT SUMMARIES
-- ============================================================================

-- Delete summaries for affected dates so they can be recalculated
-- (Only for devices that had phantom sessions)

DELETE FROM summaries_daily
WHERE date >= '2025-10-28'
  AND device_id IN (
    SELECT DISTINCT device_key
    FROM runtime_sessions_backup_20251104
  );

-- Verify summary deletion
SELECT
  d.device_key,
  COUNT(*) as summaries_deleted
FROM summaries_daily s
JOIN devices d ON d.device_id = s.device_id
WHERE s.date >= '2025-10-28'
  AND d.device_key IN (
    SELECT DISTINCT device_key
    FROM runtime_sessions_backup_20251104
  )
GROUP BY d.device_key;

-- ============================================================================
-- STEP 6: VERIFY CLEANUP
-- ============================================================================

-- Check remaining runtime for device 521795277786
SELECT
  terminated_reason,
  COUNT(*) as session_count,
  ROUND((SUM(runtime_seconds) / 3600.0)::numeric, 2) as total_hours,
  MAX(runtime_seconds) as max_runtime_seconds
FROM runtime_sessions
WHERE device_key = '521795277786'
  AND started_at >= '2025-10-28'
GROUP BY terminated_reason;

-- Expected result:
-- posted_runtime: ~4 hours (correct)
-- tail_close: 0 hours or only sessions < 2 hours

COMMIT;

-- ============================================================================
-- STEP 7: RECALCULATE SUMMARIES (Run via API)
-- ============================================================================

-- After cleanup, trigger summary recalculation:
-- curl -X GET "https://core-ingest-ingest.up.railway.app/workers/run-summary?days=7"

-- ============================================================================
-- ROLLBACK PROCEDURE (If needed)
-- ============================================================================

-- If something went wrong, restore from backup:
--
-- BEGIN;
--
-- INSERT INTO runtime_sessions
-- SELECT * FROM runtime_sessions_backup_20251104
-- ON CONFLICT (session_id) DO NOTHING;
--
-- COMMIT;
