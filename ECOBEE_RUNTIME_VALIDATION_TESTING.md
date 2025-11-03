# Ecobee Runtime Validation - Testing Guide

## Overview
This guide provides step-by-step testing instructions for the Ecobee Runtime Report validation system.

## Prerequisites
- Core-ingest deployed to Railway
- DATABASE_URL configured in Railway
- CORE_API_KEY configured in Railway

## Step 1: Run Migrations

After deployment, migrations will run automatically. To verify:

```bash
# Check if tables were created
railway run psql $DATABASE_URL -c "\dt ecobee_runtime_intervals"

# Check if validation columns were added
railway run psql $DATABASE_URL -c "\d summaries_daily" | grep validation
```

## Step 2: Create Test Device and Summary

```bash
railway run psql $DATABASE_URL << 'EOF'
INSERT INTO devices (device_key, device_id, workspace_id, user_id)
VALUES ('test_device_123', 'test_123', 'test_workspace', 'test_user')
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO summaries_daily (device_id, date, runtime_seconds_total, runtime_seconds_cool, runtime_seconds_heat, runtime_seconds_auxheat, runtime_seconds_fan)
VALUES ('test_123', '2024-11-02', 400, 400, 0, 0, 400)
ON CONFLICT (device_id, date) DO UPDATE
SET runtime_seconds_total = 400,
    runtime_seconds_cool = 400,
    runtime_seconds_fan = 400;
EOF
```

## Step 3: Test Runtime Report Endpoint

```bash
# Get your Railway domain
RAILWAY_DOMAIN="your-app.railway.app"

# Test the endpoint
curl -X POST https://${RAILWAY_DOMAIN}/ingest/v1/runtime-report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${CORE_API_KEY}" \
  -d @test-runtime-report.json
```

**Expected Response:**
```json
{
  "ok": true,
  "stored": 3,
  "summary": {
    "total_runtime_seconds": 720,
    "heating_seconds": 0,
    "cooling_seconds": 720,
    "auxheat_seconds": 0,
    "fan_seconds": 720,
    "coverage_percent": 1.04,
    "interval_count": 3
  }
}
```

## Step 4: Verify Data Stored

```bash
railway run psql $DATABASE_URL << 'EOF'
SELECT interval_timestamp, comp_cool1_seconds, fan_seconds
FROM ecobee_runtime_intervals
WHERE device_key = 'test_device_123'
ORDER BY interval_timestamp;
EOF
```

**Expected Output:**
```
interval_timestamp    | comp_cool1_seconds | fan_seconds
2024-11-02 00:00:00Z  | 180                | 180
2024-11-02 00:05:00Z  | 300                | 300
2024-11-02 00:10:00Z  | 240                | 240
```

## Step 5: Run Validation Worker

```bash
# Run the validation worker
railway run npm run worker:validate
```

**Expected Output:**
```
🔍 [RuntimeValidator] Starting validation for last 1 day(s)...
[RuntimeValidator] ✅ Validated 1 daily summaries in 2s
[RuntimeValidator] ⚠️ Found 1 significant discrepancies (>5 min):
  test_123 on 2024-11-02: calculated=400s, validated=720s, discrepancy=5min, coverage=1.0%
[RuntimeValidator] 📊 Stats:
  Total validated: 1
  Corrected: 1
  Avg coverage: 1.0%
  Avg discrepancy: 320s
```

## Step 6: Verify Validation Results

```bash
railway run psql $DATABASE_URL << 'EOF'
SELECT
  device_id,
  date,
  runtime_seconds_total as calculated,
  validated_runtime_seconds_total as validated,
  validation_discrepancy_seconds as discrepancy,
  is_corrected,
  validation_coverage_percent as coverage
FROM summaries_daily
WHERE device_id = 'test_123' AND date = '2024-11-02';
EOF
```

**Expected Output:**
```
device_id | date       | calculated | validated | discrepancy | is_corrected | coverage
test_123  | 2024-11-02 | 400        | 720       | 320         | true         | 1.04
```

## Step 7: Verify Indexes

```bash
railway run psql $DATABASE_URL << 'EOF'
SELECT indexname FROM pg_indexes
WHERE tablename = 'ecobee_runtime_intervals'
ORDER BY indexname;

SELECT indexname FROM pg_indexes
WHERE tablename = 'summaries_daily'
  AND indexname LIKE '%validation%'
ORDER BY indexname;
EOF
```

## Monitoring Queries

### Last Validation Run
```sql
SELECT MAX(validation_performed_at) as last_run,
       COUNT(*) as total_validated
FROM summaries_daily
WHERE validation_source = 'ecobee_runtime_report';
```

### Recent Discrepancies
```sql
SELECT
  device_id,
  date,
  runtime_seconds_total as calculated,
  validated_runtime_seconds_total as validated,
  validation_discrepancy_seconds as discrepancy,
  validation_coverage_percent as coverage
FROM summaries_daily
WHERE validation_discrepancy_seconds > 300
  AND validation_performed_at >= NOW() - INTERVAL '7 days'
ORDER BY validation_discrepancy_seconds DESC
LIMIT 20;
```

### Data Quality Metrics
```sql
SELECT
  COUNT(*) FILTER (WHERE validation_source IS NOT NULL) as validated_count,
  COUNT(*) FILTER (WHERE is_corrected = TRUE) as corrected_count,
  AVG(validation_coverage_percent) as avg_coverage,
  AVG(validation_discrepancy_seconds) as avg_discrepancy
FROM summaries_daily
WHERE validation_performed_at >= NOW() - INTERVAL '30 days';
```

## Scheduling the Validation Worker on Railway

1. Go to Railway project settings
2. Add a new Cron Job service
3. Configure:
   - **Schedule**: `0 4 * * *` (Daily at 04:00 UTC)
   - **Command**: `npm run worker:validate`
4. Save and deploy

## Success Criteria

✅ Migrations applied successfully
✅ Runtime report endpoint accepts and stores interval data
✅ Validation worker runs without errors
✅ Calculated and validated values stored in summaries_daily
✅ Discrepancies flagged when > 5 minutes
✅ Existing device types continue functioning normally

## Troubleshooting

### Endpoint returns 404
- Check server logs: `railway logs`
- Verify route is registered in server.ts
- Ensure build completed successfully

### Validation worker fails
- Check DATABASE_URL is set correctly
- Verify migrations have been applied
- Check for runtime interval data: `SELECT COUNT(*) FROM ecobee_runtime_intervals;`

### No discrepancies detected
- Verify test data was inserted correctly
- Check that summaries_daily has matching records
- Ensure device_key matches between tables
