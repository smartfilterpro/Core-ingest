# Summary Validation Guide

## Overview

This guide helps you validate that summary data is being generated correctly and identify any date gaps in the summary pipeline.

## Problem Description

You may notice that summary data exists for some dates (e.g., 10/31, 10/27, 10/25, 10/22) but is missing for dates in between. This can happen for several reasons:

1. **Cron jobs not running** - The summary worker may not be executing on schedule
2. **Source data gaps** - No runtime_sessions data exists for those dates
3. **Processing errors** - The summary worker encountered errors during processing
4. **Database issues** - Connection or query failures

## New Validation Endpoints

### 1. `/summaries/validate` - Comprehensive Validation

This endpoint analyzes summary completeness and identifies date gaps.

**Usage:**

```bash
# Validate all summaries for the last 30 days
curl "http://localhost:8080/summaries/validate?days=30"

# Validate summaries for a specific device
curl "http://localhost:8080/summaries/validate?device_id=123&days=30"
```

**Response Example:**

```json
{
  "ok": true,
  "validation": {
    "period": {
      "days": 30,
      "start_date": "2024-10-02",
      "end_date": "2024-11-01",
      "total_expected_dates": 31
    },
    "statistics": {
      "total_summaries": 450,
      "total_summary_days": 15,
      "devices_with_summaries": 30,
      "earliest_summary": "2024-10-22",
      "latest_summary": "2024-10-31",
      "last_updated": "2024-11-01T10:30:00Z"
    },
    "health": {
      "source_data_dates": 20,
      "summary_dates": 15,
      "date_gaps_count": 5,
      "coverage_percent": 75
    },
    "date_gaps": [
      {
        "date": "2024-10-30",
        "device_id": 123,
        "device_name": "Living Room Thermostat",
        "device_key": "ecobee_abc123"
      },
      {
        "date": "2024-10-29",
        "device_id": 123,
        "device_name": "Living Room Thermostat",
        "device_key": "ecobee_abc123"
      }
    ],
    "missing_source_dates": ["2024-10-01", "2024-10-02"],
    "missing_summary_dates": ["2024-10-28", "2024-10-29", "2024-10-30"]
  }
}
```

**Key Fields:**

- `coverage_percent` - Percentage of dates with source data that have summaries
- `date_gaps` - Dates with runtime_sessions but no summaries (ACTION REQUIRED)
- `missing_source_dates` - Dates with no runtime_sessions (device was offline)
- `missing_summary_dates` - Dates missing summaries (may overlap with gaps)

### 2. `/summaries/dates-present` - Simple Date List

This endpoint provides a quick view of which dates have summary data.

**Usage:**

```bash
# List all dates with summaries
curl "http://localhost:8080/summaries/dates-present?days=30"

# List dates for specific device
curl "http://localhost:8080/summaries/dates-present?device_id=123&days=30"
```

**Response Example:**

```json
{
  "ok": true,
  "count": 4,
  "dates": [
    { "date": "2024-10-31", "device_count": 30 },
    { "date": "2024-10-27", "device_count": 28 },
    { "date": "2024-10-25", "device_count": 29 },
    { "date": "2024-10-22", "device_count": 27 }
  ]
}
```

## Diagnosing Issues

### Step 1: Check for Date Gaps

```bash
curl "http://localhost:8080/summaries/validate?days=30" | jq '.validation.date_gaps'
```

If you see date gaps:
- **date_gaps.length > 0** → Source data exists but summaries weren't generated
- **coverage_percent < 100%** → Summary worker may not be running or failing

### Step 2: Check Source Data

```bash
# Check if runtime_sessions exist for the missing dates
psql $DATABASE_URL -c "
  SELECT DATE(started_at) as date, COUNT(*) as session_count
  FROM runtime_sessions
  WHERE started_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY DATE(started_at)
  ORDER BY date DESC;
"
```

### Step 3: Check Cron Job Status

```bash
# Check logs for cron job execution
docker logs <container_name> | grep "Summary Worker"

# Look for:
# [CRON] Running Summary Worker...
# [CRON] ✅ Summary Worker completed
# [CRON] ❌ Summary Worker failed: <error>
```

### Step 4: Check Last Summary Update

```bash
curl "http://localhost:8080/summaries/validate?days=7" | jq '.validation.statistics.last_updated'
```

If `last_updated` is old (> 10 minutes ago), the cron job may not be running.

## Fixing Missing Summaries

### Option 1: Backfill Specific Date Range

```bash
# Backfill last 30 days
npm run worker:summary -- --days=30

# Or via API
curl -X GET "http://localhost:8080/workers/run-all"
```

### Option 2: Backfill All History

```bash
# Process all historical data
npm run worker:summary:all

# Or via API
curl -X GET "http://localhost:8080/workers/backfill-summaries"
```

### Option 3: Manual SQL Fix

If you know the specific dates missing:

```sql
-- This runs the same logic as the summary worker for a specific date range
-- Replace '2024-10-28' and '2024-10-30' with your missing dates

-- (Run the full summary worker query from summaryWorker.ts with custom date filter)
```

## Monitoring Summary Health

### Daily Health Check

Add this to your monitoring:

```bash
#!/bin/bash
# check-summary-health.sh

COVERAGE=$(curl -s "http://localhost:8080/summaries/validate?days=7" | jq '.validation.health.coverage_percent')

if [ "$COVERAGE" -lt 95 ]; then
  echo "⚠️  Summary coverage is low: ${COVERAGE}%"
  echo "Running backfill..."
  curl -X GET "http://localhost:8080/workers/run-all"
else
  echo "✅ Summary coverage is healthy: ${COVERAGE}%"
fi
```

### Alert Conditions

Set up alerts for:
- `coverage_percent < 95%` - Summaries are missing
- `date_gaps.length > 3` - Multiple days missing
- `last_updated > 20 minutes ago` - Cron may be stuck

## Summary Worker Configuration

The summary worker runs every 10 minutes via cron:

```typescript
// src/cron.ts
cron.schedule('*/10 * * * *', async () => {
  await runSummaryWorker(pool);
});
```

**Default Lookback:** 7 days

**Customization:**
- Change lookback: `runSummaryWorker(pool, { days: 30 })`
- Process all history: `runSummaryWorker(pool, { fullHistory: true })`

## Common Issues and Solutions

### Issue: Summaries missing for recent dates

**Cause:** Cron job not running or failing

**Solution:**
1. Check if main server is running: `docker ps`
2. Check logs: `docker logs <container> | grep Summary`
3. Manually trigger: `curl http://localhost:8080/workers/run-all`

### Issue: Summaries missing for old dates

**Cause:** Only last 7 days processed by default

**Solution:**
```bash
npm run worker:summary -- --days=60  # Process last 60 days
```

### Issue: No source data (runtime_sessions) for dates

**Cause:**
- Device was offline/not reporting
- Session stitcher not running
- equipment_events missing

**Solution:**
1. Check equipment_events: `SELECT COUNT(*) FROM equipment_events WHERE recorded_at::date = '2024-10-28'`
2. Run session stitcher: `npm run worker:session`
3. Then run summary worker

### Issue: Coverage < 100% but no obvious gaps

**Cause:** Multiple devices with different gaps

**Solution:**
```bash
# Check per-device
curl "http://localhost:8080/summaries/validate?device_id=123&days=30"
```

## Technical Details

### Data Flow

```
equipment_events (raw sensor data)
    ↓ [Session Stitcher - every 5 min]
runtime_sessions (aggregated sessions)
    ↓ [Summary Worker - every 10 min]
summaries_daily (daily summaries)
    ↓ [Region Aggregation - every hour]
region_averages (regional data)
```

### Summary Worker Query

The worker:
1. Queries `runtime_sessions` for equipment runtime by mode
2. Queries `equipment_events` for thermostat mode durations
3. Joins and aggregates by device + date
4. Upserts into `summaries_daily`

### Validation Queries

The validation endpoint:
1. Gets all dates from `runtime_sessions` (expected dates)
2. Gets all dates from `summaries_daily` (actual dates)
3. Compares to find gaps
4. Returns statistics and missing dates

## API Reference

| Endpoint | Method | Parameters | Description |
|----------|--------|------------|-------------|
| `/summaries/validate` | GET | `device_id?`, `days?` | Validate summary completeness |
| `/summaries/dates-present` | GET | `device_id?`, `days?` | List dates with summaries |
| `/summaries/daily` | GET | `device_id`, `days?` | Get daily summaries |
| `/workers/run-all` | GET | - | Run all workers manually |
| `/workers/backfill-summaries` | GET | - | Backfill all historical data |

## Best Practices

1. **Regular Validation** - Run `/summaries/validate` daily to catch issues early
2. **Monitor Coverage** - Alert when coverage < 95%
3. **Backfill Promptly** - Fix gaps within 24 hours to maintain data integrity
4. **Check Logs** - Review cron logs weekly for any failures
5. **Database Health** - Ensure database has enough resources (connections, CPU, memory)

## Questions?

If you continue to see missing summaries after following this guide:

1. Check database connectivity: `psql $DATABASE_URL -c "SELECT NOW()"`
2. Check worker logs: `docker logs <container> --tail 100 | grep -A 5 "Summary Worker"`
3. Review source data: `SELECT COUNT(*) FROM runtime_sessions WHERE started_at >= NOW() - INTERVAL '7 days'`
4. Open an issue with the validation output and logs
