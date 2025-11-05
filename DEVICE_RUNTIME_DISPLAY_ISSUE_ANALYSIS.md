# Device Runtime Display Issue Analysis

## Issue Summary
Device **48A2E683C449** shows:
- ❌ 0 hours of total runtime on frontend
- ✅ 74% filter health on frontend
- ⚠️  Manual "run all" did not update either field

## System Architecture Overview

### Data Flow for Runtime and Filter Health

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INGEST: Equipment Events → equipment_events table           │
│    Source: /ingest/v1/events:batch OR /ingest/v1/runtime-report│
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. SESSION STITCHER: equipment_events → runtime_sessions       │
│    Worker: sessionStitcher.ts (every 5 minutes)                │
│    Updates:                                                     │
│    - runtime_sessions table                                    │
│    - device_states (hours_used_total, filter_hours_used)       │
│    - devices.filter_usage_percent ✓                           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. SUMMARY WORKER: runtime_sessions → summaries_daily          │
│    Worker: summaryWorker.ts (every 10 minutes)                 │
│    Aggregates: runtime_seconds_total per day                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. BUBBLE SYNC: summaries_daily → Bubble Frontend              │
│    Worker: bubbleSummarySync.ts (every 15 minutes)             │
│    Syncs: runtime_seconds_total, runtime_sessions_count, etc.  │
└─────────────────────────────────────────────────────────────────┘
```

### Important: Separate Data Paths

**Filter Health (74%):**
- ✓ Calculated by Session Stitcher from `device_states.filter_hours_used`
- ✓ Stored in `devices.filter_usage_percent`
- ✓ Retrieved via `/summaries/filter-status/:deviceKey` endpoint
- ✓ Formula: `(filter_hours_used / filter_target_hours) * 100`

**Total Runtime (0 hours):**
- Uses `summaries_daily.runtime_seconds_total`
- Aggregated from `runtime_sessions` by Summary Worker
- Frontend likely queries `/summaries/device/:deviceId` or `/summaries/daily`

## Root Cause Analysis

### Why Filter Health Works But Runtime Doesn't

The discrepancy suggests:

1. ✅ **Equipment events ARE being ingested** (otherwise filter health wouldn't update)
2. ✅ **Session Stitcher IS running** (updates filter_usage_percent)
3. ❌ **Summary Worker may NOT be processing this device's data**
4. ❌ **OR Bubble is not correctly displaying summaries_daily data**

### Possible Causes

#### 1. Missing or Invalid Runtime Sessions
- `equipment_events` exist but are not creating valid `runtime_sessions`
- Sessions might be rejected due to phantom session protection (max 2 hour limit)
- Check: `runtime_sessions` table for device_key `48A2E683C449`

#### 2. Summary Worker Not Processing Device
- Device might not have `device_id` set (only `device_key`)
- Summary Worker joins on `device_id` in line 89 of summaryWorker.ts
- Check: `devices` table for device has both `device_key` AND `device_id`

#### 3. Summaries Not Being Calculated
- No data in `summaries_daily` for this device
- Summary Worker filters by date (default: last 7 days)
- If all sessions are older than 7 days, they won't be in summaries
- Check: `summaries_daily` table for device_id

#### 4. Frontend Query Issue
- Frontend might be querying wrong device_id
- Frontend might be summing summaries incorrectly
- Check: What endpoint is frontend calling?

#### 5. Bubble Sync Not Sending Data
- `bubbleSummarySync` only syncs last 25 updated summaries
- If device hasn't been updated recently, it won't be synced
- Check: `summaries_daily.updated_at` for this device

## Diagnostic Process

### Step 1: Run the Diagnostic Script

I've created `/scripts/check-device.ts` to diagnose this issue:

```bash
# Set DATABASE_URL first (get from Railway dashboard)
export DATABASE_URL="postgresql://..."

# Run diagnostic
npx ts-node scripts/check-device.ts
```

This will show:
- ✓ Device record from `devices` table
- ✓ Device state from `device_states` table
- ✓ Runtime sessions count and totals
- ✓ Summaries count and totals
- ✓ Equipment events count
- ✓ Recent events, sessions, and summaries

### Step 2: Check Cron Jobs Are Running

Verify workers are running:

```bash
# Check logs for cron job execution
heroku logs --tail --app your-app-name | grep CRON

# Or on Railway:
# Check deployment logs for "[CRON]" messages
```

Expected to see:
- `[CRON] Running Session Stitcher...` (every 5 min)
- `[CRON] Running Summary Worker...` (every 10 min)
- `[CRON] Running Bubble Sync...` (every 15 min)

### Step 3: Manual Worker Execution

Force run workers manually:

```bash
# Run Session Stitcher
npm run worker:session

# Run Summary Worker (last 7 days)
npm run worker:summary

# Run Summary Worker (all history)
npm run worker:summary -- --all

# Check summaries validation
curl "https://your-api.railway.app/summaries/validate?device_id=48A2E683C449"
```

### Step 4: Check Database Tables Directly

```sql
-- 1. Check device record
SELECT device_key, device_id, device_name, filter_usage_percent,
       filter_target_hours, use_forced_air_for_heat
FROM devices
WHERE device_key = '48A2E683C449';

-- 2. Check device state
SELECT device_key, hours_used_total, filter_hours_used,
       last_event_ts, last_reset_ts, is_active
FROM device_states
WHERE device_key = '48A2E683C449';

-- 3. Check runtime sessions
SELECT COUNT(*) as session_count,
       SUM(runtime_seconds) as total_runtime_seconds,
       MIN(started_at) as first_session,
       MAX(started_at) as last_session
FROM runtime_sessions
WHERE device_key = '48A2E683C449';

-- 4. Check summaries (CRITICAL - uses device_id not device_key!)
SELECT COUNT(*) as summary_days,
       SUM(runtime_seconds_total) as total_runtime_seconds,
       MIN(date) as first_date,
       MAX(date) as last_date
FROM summaries_daily
WHERE device_id = (
  SELECT device_id FROM devices WHERE device_key = '48A2E683C449'
);

-- 5. Check recent equipment events
SELECT COUNT(*) as event_count,
       MIN(recorded_at) as first_event,
       MAX(recorded_at) as last_event
FROM equipment_events
WHERE device_key = '48A2E683C449';
```

## Common Fixes

### Fix 1: Missing device_id
If device has `device_key` but no `device_id`:

```sql
-- Set device_id to match device_key
UPDATE devices
SET device_id = device_key
WHERE device_key = '48A2E683C449' AND device_id IS NULL;

-- Then re-run Summary Worker
```

### Fix 2: No Runtime Sessions Created
If equipment_events exist but no runtime_sessions:

```bash
# Re-run Session Stitcher
npm run worker:session

# Check for errors in logs
```

### Fix 3: Summaries Not Calculated
If runtime_sessions exist but no summaries_daily:

```bash
# Run Summary Worker with full history
npm run worker:summary -- --all

# Then force Bubble sync
npm run worker:bubble-sync
```

### Fix 4: Old Sessions Beyond 7-Day Window
If all sessions are older than 7 days:

```bash
# Process all history
npm run worker:summary -- --all

# Or specific days
npm run worker:summary -- --days=30
```

## Frontend Display Issue

### Check What Endpoint Frontend Uses

The frontend should call:

**For Total Runtime:**
```
GET /summaries/device/:deviceId
Returns: { total_runtime_seconds, total_sessions, ... }
```

**For Filter Health:**
```
GET /summaries/filter-status/:deviceKey
Returns: { filter_usage_percent, filter_hours_used, ... }
```

Note: Runtime uses `device_id`, filter health uses `device_key`!

### Verify Bubble API Call

Check Bubble API Connector is calling the correct endpoint:
- ✓ Using `/summaries/device/:deviceId` (not `/summaries/daily`)
- ✓ Using correct `device_id` (not `device_key`)
- ✓ Converting `total_runtime_seconds` to hours: `total_runtime_seconds / 3600`

## Automatic Processes Confirmation

### ✅ Session Stitcher (Every 5 Minutes)
- Creates `runtime_sessions` from `equipment_events`
- Updates `device_states.filter_hours_used`
- Updates `devices.filter_usage_percent`
- **STATUS: Working** (evidenced by 74% filter health)

### ✅ Summary Worker (Every 10 Minutes)
- Aggregates `runtime_sessions` into `summaries_daily`
- Processes last 7 days by default
- **STATUS: Unknown** (needs verification with diagnostic script)

### ✅ Bubble Sync (Every 15 Minutes)
- Syncs last 25 updated summaries to Bubble
- **STATUS: Unknown** (may not be syncing this device)

## Next Steps

1. **Run the diagnostic script** to identify which table has missing data
2. **Check the cron job logs** to ensure workers are running
3. **Manually run workers** to process any backlog
4. **Verify frontend** is calling the correct endpoint with correct device_id
5. **Check for data inconsistencies** between device_key and device_id

## Files to Review

- `src/workers/sessionStitcher.ts` - Creates sessions and updates filter health
- `src/workers/summaryWorker.ts` - Aggregates sessions into daily summaries
- `src/workers/bubbleSummarySync.ts` - Syncs summaries to Bubble
- `src/routes/summaries.ts` - API endpoints for frontend
- `src/cron.ts` - Cron job schedules

## Key Insight

The fact that **filter health is 74%** but **runtime is 0 hours** strongly suggests:

1. ✅ Equipment events ARE being ingested
2. ✅ Session Stitcher IS running and updating device_states
3. ❌ EITHER summaries_daily has no data for this device
4. ❌ OR frontend is not correctly querying/displaying summaries_daily

**Most likely cause:** Device has `device_key` but missing/incorrect `device_id`, causing Summary Worker to skip it (line 89-114 in summaryWorker.ts requires device_id).

---

**Created:** 2025-11-05
**Device:** 48A2E683C449
**Issue:** 0 hours runtime, 74% filter health
**Status:** Diagnostic script created, awaiting database access to confirm root cause
