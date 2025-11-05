# Filter Percentage Calculation Issue

## Problem Statement

Device **5CFCE18CEAD7** shows:
- ❌ **23 hours** of runtime on frontend
- ❌ **4%** filter usage on frontend
- ✓ **805 hours** target filter life

**Expected calculation:** 23 / 805 = 2.86% ≈ **3%**
**Actual showing:** **4%**

## Root Cause Analysis

### The Data Source Mismatch

The issue stems from **two different data sources** being used for runtime and filter percentage:

```
Frontend Runtime (23 hours)
  ↓
  FROM summaries_daily (SUM of all days)
  ↓
  May only include last 7-30 days depending on query

Frontend Filter % (4%)
  ↓
  FROM devices.filter_usage_percent
  ↓
  Calculated from device_states.filter_hours_used
  ↓
  Includes ALL runtime since last filter reset
```

### Why This Happens

1. **`summaries_daily`** is populated by Summary Worker
   - Processes last 7 days by default (configurable)
   - Frontend queries this for "total runtime"
   - If older data not processed, frontend shows incomplete total

2. **`device_states.filter_hours_used`** is maintained by Session Stitcher
   - Real-time tracking of ALL filter usage since last reset
   - Never loses historical data
   - Always includes complete filter usage history

3. **Result:** Frontend compares partial runtime (23h) against complete filter percentage (4% = ~32h)

### The Math Confirms It

If frontend shows **4%** filter usage with **805 hour** target:
```
4% = (filter_hours_used / 805) * 100
filter_hours_used = 0.04 * 805 = 32.2 hours
```

So the device actually has **~32 hours** of filter runtime, but frontend only shows **23 hours** of total runtime.

This means **~9 hours of runtime** (32 - 23 = 9) is in `device_states` but not in `summaries_daily`.

## Why summaries_daily Might Be Incomplete

### Reason 1: Summary Worker Date Range
The Summary Worker only processes last 7 days by default:

```typescript
// src/workers/summaryWorker.ts line 11
const dateFilter = options?.fullHistory
  ? '' // No date filter = process all data
  : `AND rs.started_at >= CURRENT_DATE - INTERVAL '${options?.days || 7} days'`;
```

**Impact:** If device has been running for 30+ days since last filter reset, summaries_daily only has last 7 days, but device_states has all 30+ days.

### Reason 2: Missing Device ID
Summary Worker requires `device_id` (not just `device_key`):

```typescript
// src/workers/summaryWorker.ts line 89-111
FROM devices d
INNER JOIN all_event_dates aed ON aed.device_key = d.device_key
WHERE d.device_id IS NOT NULL  // <-- CRITICAL
```

**Impact:** If device has `device_key` but missing `device_id`, Summary Worker skips it entirely.

### Reason 3: Summaries Not Yet Calculated
Summary Worker runs every 10 minutes but only for recent dates.

**Impact:** Historical data may never have been processed.

## The Filter Logic Difference

There's also a difference between **total runtime** and **filter runtime**:

### What Counts Toward Filter Usage

The `countsTowardFilter` function (sessionStitcher.ts:83-108) only counts certain operations:

**✅ Always counts:**
- Cooling
- Fan-only
- Heating_Fan (forced air heating)
- AuxHeat_Fan (auxiliary heat with fan)

**❓ Conditionally counts:**
- Heating (only if `use_forced_air_for_heat = true`)
- AuxHeat (only if `use_forced_air_for_heat = true`)

**Impact:** If device has radiant/baseboard heating (not forced air), that runtime doesn't count toward filter usage. This could explain additional discrepancy.

## Solution Options

### Option 1: Use Consistent Data Source (RECOMMENDED)

**Change frontend to use `device_states` for BOTH metrics:**

```
GET /api/device-runtime-and-filter/:deviceKey
```

Create new endpoint:

```typescript
router.get('/device-runtime-and-filter/:deviceKey', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      d.device_key,
      d.device_id,
      d.device_name,
      d.filter_target_hours,
      d.filter_usage_percent,
      ds.hours_used_total,
      ds.filter_hours_used,
      ds.last_reset_ts,
      EXTRACT(EPOCH FROM (NOW() - ds.last_reset_ts))/86400 as days_since_reset
    FROM devices d
    INNER JOIN device_states ds ON ds.device_key = d.device_key
    WHERE d.device_key = $1
  `, [req.params.deviceKey]);

  res.json({
    ok: true,
    total_runtime_hours: rows[0].hours_used_total,
    filter_runtime_hours: rows[0].filter_hours_used,
    filter_usage_percent: rows[0].filter_usage_percent,
    filter_target_hours: rows[0].filter_target_hours,
    days_since_reset: rows[0].days_since_reset
  });
});
```

**Pros:**
- ✅ Always consistent
- ✅ Real-time data
- ✅ No sync delays

**Cons:**
- ❌ Requires frontend changes

### Option 2: Process All Historical Data

**Run Summary Worker with full history:**

```bash
npm run worker:summary -- --all
```

Or update cron to process longer window:

```typescript
// src/cron.ts
cron.schedule('*/10 * * * *', async () => {
  await runSummaryWorker(pool, { days: 365 }); // Process last year
});
```

**Pros:**
- ✅ Fills in historical summaries_daily data
- ✅ No frontend changes needed

**Cons:**
- ❌ More expensive queries
- ❌ Doesn't fix ongoing sync issues
- ❌ Still has timing lag

### Option 3: Add device_states to Frontend Endpoint

**Augment existing endpoint to include device_states:**

```typescript
router.get('/device/:deviceId', async (req, res) => {
  // Existing summaries_daily query
  const summaryResult = await pool.query(`
    SELECT SUM(runtime_seconds_total) as total_runtime_seconds, ...
    FROM summaries_daily WHERE device_id = $1
  `, [deviceId]);

  // ALSO get device_states
  const stateResult = await pool.query(`
    SELECT hours_used_total, filter_hours_used, filter_usage_percent
    FROM device_states ds
    INNER JOIN devices d ON d.device_key = ds.device_key
    WHERE d.device_id = $1
  `, [deviceId]);

  res.json({
    summary: summaryResult.rows[0],
    real_time: stateResult.rows[0]  // Add this!
  });
});
```

**Pros:**
- ✅ Provides both data sources
- ✅ Frontend can choose which to display
- ✅ Backward compatible

**Cons:**
- ❌ Requires frontend changes to use new field

## Immediate Fix

### For This Specific Device

1. **Run diagnostic:**
   ```bash
   export DATABASE_URL="your_database_url"
   npx ts-node scripts/check-filter-calculation.ts
   ```

2. **Check if summaries need processing:**
   ```bash
   npm run worker:summary -- --all
   ```

3. **Verify the calculation:**
   ```sql
   -- Get actual numbers
   SELECT
     d.device_key,
     d.filter_target_hours,
     d.filter_usage_percent,
     ds.hours_used_total,
     ds.filter_hours_used,
     ROUND((ds.filter_hours_used / d.filter_target_hours) * 100) as calculated_percent
   FROM devices d
   INNER JOIN device_states ds ON ds.device_key = d.device_key
   WHERE d.device_key = '5CFCE18CEAD7';
   ```

### Expected Results

You should see something like:
```
device_key: 5CFCE18CEAD7
filter_target_hours: 805
filter_usage_percent: 4
hours_used_total: 32.2
filter_hours_used: 32.2
calculated_percent: 4
```

This would confirm that:
- ✅ Calculation is **correct** (4% from 32 hours)
- ❌ Frontend is showing **wrong data** (23 hours from incomplete summaries_daily)

## Long-Term Fix

### Recommended: Use device_states as Source of Truth

The `device_states` table is the authoritative source for runtime tracking:

1. **Always up-to-date** (updated every 5 minutes by Session Stitcher)
2. **Complete history** since last filter reset
3. **Consistent** with filter_usage_percent calculation
4. **Real-time** (no summary lag)

**Implementation:**

1. Create new endpoint (see Option 3 above)
2. Update frontend to use `device_states.hours_used_total` instead of `summaries_daily`
3. Keep `summaries_daily` for historical charts/analytics only

## Testing

After implementing fix, verify:

```bash
# 1. Check device_states
curl "https://api.url/device-runtime/:deviceKey"

# 2. Verify calculation matches
# hours_used_total / filter_target_hours * 100 = filter_usage_percent

# 3. Check frontend displays same values
```

## Summary

**Problem:** Frontend shows 23h runtime with 4% filter usage (should be 3%)

**Root Cause:**
- Runtime from `summaries_daily` (incomplete, last 7 days only)
- Filter % from `device_states.filter_hours_used` (complete history)

**Fix:** Use `device_states` for both runtime and filter percentage

**Impact:** Consistent, real-time data with no sync delays

---

**Created:** 2025-11-05
**Device:** 5CFCE18CEAD7
**Issue:** Inconsistent runtime vs filter percentage
**Status:** Diagnostic tools created, awaiting database verification
