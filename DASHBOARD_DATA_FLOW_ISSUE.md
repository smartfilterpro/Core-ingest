# Dashboard Data Flow Issue - Root Cause Analysis

**Date:** 2025-11-05
**Device ID:** 521795277786
**Issue:** Frontend displaying incorrect runtime hours (23 hours vs actual 64.3275 hours)

## Problem Summary

The frontend Dashboard is showing **23 hours** of total runtime, while the Core-ingest backend has the correct **64.3275 hours** of real-time data. This 41+ hour discrepancy is causing:

- Incorrect filter life calculations (788 days remaining instead of realistic value)
- Inaccurate filter usage percentage displays
- Misleading "days remaining" predictions

## Root Cause

**The frontend is NOT using the `real_time` data from the Core-ingest API.**

### What's Happening:

1. **Core-ingest Backend** provides the `/summaries/device/{deviceId}` endpoint with TWO data sources:

   ```json
   {
     "real_time": {
       "total_runtime_hours": 64.3275,      // ✅ CORRECT - Real-time from device_states
       "filter_runtime_hours": 64.3275,
       "filter_usage_percent": 8,
       "filter_target_hours": 805,
       "hours_remaining": 740.6725
     },
     "summaries": {
       "total_runtime_hours": 23,            // ❌ INCOMPLETE - Only from processed daily summaries
       "total_sessions": 71,
       "days_recorded": 15
     }
   }
   ```

2. **The frontend is either:**
   - Not calling this endpoint at all, OR
   - Calling it but only using the `summaries` data instead of `real_time`

### Evidence from Console Logs:

```javascript
Dashboard.tsx:175 ✅ Received 15 lifetime summaries
Dashboard.tsx:180 📊 Sample summary data: {date: '2025-11-05T00:00:00.000Z', total: 2820...}
Dashboard.tsx:595 🔧 Filter Life from backend filter_usage_percent: {
  filter_usage_percent: '8.00',
  totalRuntimeHours: '23.0',  // ❌ Wrong - using summaries data
  daysRemaining: 788           // ❌ Wrong - calculated from incomplete data
}
```

The frontend is calculating from `summaries_daily` table (which only has 15 days of processed data = 23 hours), instead of using the `device_states` real-time accumulation (64.3275 hours).

## Data Flow Comparison

### Current (Broken) Flow:
```
Core-ingest → summaries_daily (15 days) → Frontend
              ↓
              23 hours (incomplete) → 788 days remaining ❌
```

### Correct Flow Should Be:
```
Core-ingest → device_states (real-time) → Frontend
              ↓
              64.3275 hours (complete) → ~120 days remaining ✅
```

## Why There's a Discrepancy

The `summaries_daily` table contains daily aggregations that are:
- **Processed asynchronously** by workers
- **May have gaps** in historical data
- **Intentionally incomplete** for recent/current data

The `device_states` table contains:
- **Real-time runtime accumulation** from every ingested event
- **Complete and authoritative** data
- **Recommended for frontend display** (see line 143 in summaries.ts)

## The Solution

The frontend **MUST** use the `/summaries/device/{deviceId}` endpoint and consume the `real_time` object instead of the `summaries` object for:

1. **Total Runtime Hours:** `response.real_time.total_runtime_hours`
2. **Filter Usage Percent:** `response.real_time.filter_usage_percent`
3. **Hours Remaining:** `response.real_time.hours_remaining`
4. **Days Since Reset:** `response.real_time.days_since_reset`

### Code Location in Core-ingest:

**File:** `/src/routes/summaries.ts:70-174`

```typescript
/**
 * GET /summaries/device/:deviceId
 * Get aggregated summary for a device
 * Returns BOTH summaries_daily (historical) AND device_states (real-time) data
 */
router.get('/device/:deviceId', async (req: Request, res: Response) => {
  // ...
  res.json({
    ok: true,
    device_id: deviceId,
    device_key: deviceData.device_key,
    device_name: deviceData.device_name,

    // RECOMMENDED: Use this for frontend display (real-time, complete)
    real_time: {
      total_runtime_hours: parseFloat(deviceData.hours_used_total) || 0,
      filter_runtime_hours: parseFloat(deviceData.filter_hours_used) || 0,
      filter_usage_percent: parseFloat(deviceData.filter_usage_percent) || 0,
      filter_target_hours: parseFloat(deviceData.filter_target_hours) || 100,
      hours_remaining: parseFloat(deviceData.hours_remaining) || 0,
      days_since_reset: deviceData.days_since_reset ? Math.floor(parseFloat(deviceData.days_since_reset)) : null,
      last_event_ts: deviceData.last_event_ts,
      is_active: deviceData.is_active,
      use_forced_air_for_heat: deviceData.use_forced_air_for_heat,
    },

    // Historical aggregation from summaries_daily (may be incomplete if not all dates processed)
    summaries: {
      total_runtime_hours: summaryData.total_runtime_seconds ? parseFloat(summaryData.total_runtime_seconds) / 3600 : 0,
      total_sessions: parseInt(summaryData.total_sessions) || 0,
      avg_temperature: summaryData.avg_temperature ? parseFloat(summaryData.avg_temperature) : null,
      avg_humidity: summaryData.avg_humidity ? parseFloat(summaryData.avg_humidity) : null,
      days_recorded: parseInt(summaryData.days_recorded) || 0,
      earliest_date: summaryData.earliest_date,
      latest_date: summaryData.latest_date,
    },
  });
});
```

## Frontend Changes Required

### 1. API Call (if not already called):

```typescript
const response = await fetch(`https://core-ingest-ingest.up.railway.app/summaries/device/${deviceId}`);
const data = await response.json();
```

### 2. Use Real-Time Data:

```typescript
// ✅ CORRECT - Use real_time data
const totalRuntimeHours = data.real_time.total_runtime_hours;      // 64.3275
const filterUsagePercent = data.real_time.filter_usage_percent;    // 8
const hoursRemaining = data.real_time.hours_remaining;              // 740.6725
const daysSinceReset = data.real_time.days_since_reset;            // calculated

// ❌ WRONG - Don't use summaries data for runtime calculations
const totalRuntimeHours = data.summaries.total_runtime_hours;      // 23 (incomplete)
```

### 3. Use Summaries Data ONLY For:

The `summaries` object should ONLY be used for:
- Historical temperature/humidity averages
- Session count statistics
- Date range information
- **NOT** for runtime hours or filter calculations

## Impact

**Current (Wrong):**
- Runtime: 23 hours
- Days Remaining: 788 days
- Result: Filter appears to last 2+ years (impossible)

**After Fix:**
- Runtime: 64.3 hours
- Days Remaining: ~120 days (from AI prediction, or ~300 days calculated)
- Result: Realistic filter lifespan

## Verification

After the frontend fix, verify:

1. **API Call:**
   ```bash
   curl https://core-ingest-ingest.up.railway.app/summaries/device/521795277786
   ```
   Should show `real_time.total_runtime_hours: 64.3275`

2. **Frontend Display:**
   - Filter usage should show 8% (8 hours used per 100 hour target, or 64.3275 / 805)
   - Days remaining should be realistic (100-300 days, not 788)
   - Runtime hours should match the `real_time` value

## Additional Notes

- The AI prediction system correctly uses the real-time data (shows 120 days remaining)
- The `summaries_daily` table is still valuable for historical trends and graphs
- The Core-ingest backend is working correctly; the issue is purely frontend data consumption

## Action Items

- [ ] Frontend: Update Dashboard.tsx to call `/summaries/device/{deviceId}` endpoint
- [ ] Frontend: Use `response.real_time.*` instead of `response.summaries.*` for filter calculations
- [ ] Frontend: Verify runtime hours display matches Core-ingest real-time data
- [ ] Frontend: Verify filter life calculations use real-time hours
- [ ] Frontend: Keep using `summaries` data only for temperature/humidity/session stats
