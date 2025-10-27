# Filter Lifecycle Management

## Overview

The filter lifecycle management system tracks HVAC filter usage in real-time, respecting the `use_forced_air_for_heat` setting to accurately calculate filter wear based on actual forced air operation.

## Key Concepts

### Filter Runtime Logic

**Always Count Toward Filter Usage:**
- Cooling (any status containing "cool")
- Fan operation (any status containing "fan")

**Conditional - Based on `use_forced_air_for_heat` Setting:**
- If `use_forced_air_for_heat = true`: ALL heating runtime counts toward filter
- If `use_forced_air_for_heat = false`: ONLY heating with fan (e.g., "Heating_Fan") counts toward filter

**Examples:**
- `Cooling` → Always counts ✓
- `Cooling_Fan` → Always counts ✓
- `Fan_only` → Always counts ✓
- `Heating_Fan` → Always counts ✓ (fan is running)
- `Heating` → Only counts if `use_forced_air_for_heat = true`
- `AuxHeat` → Only counts if `use_forced_air_for_heat = true`
- `AuxHeat_Fan` → Always counts ✓ (fan is running)

## Database Schema

### devices table
- `filter_target_hours` - Max filter runtime in hours (default: 100)
- `filter_usage_percent` - Current filter usage percentage (0-100)
- `use_forced_air_for_heat` - Whether forced air is used during heating

### device_states table
- `hours_used_total` - Total runtime hours (all equipment operation)
- `filter_hours_used` - Filter-specific runtime hours (respects forced air logic)
- `last_reset_ts` - Timestamp of last filter reset

### filter_resets table
- `device_id` - Device identifier
- `user_id` - User who triggered reset
- `source` - Reset source ("manual", "automatic", etc.)
- `triggered_at` - Reset timestamp

## API Endpoints

### 1. Update Filter Target Hours
```http
POST /v2/update-device
Content-Type: application/json

{
  "device_key": "workspace_id:device_id",
  "filter_target_hours": 1000,
  "use_forced_air_for_heat": true
}
```

**Response:**
```json
{
  "ok": true
}
```

### 2. Reset Filter
```http
POST /filter-reset
Content-Type: application/json

{
  "device_id": "device_id",
  "user_id": "user_id",
  "source": "manual"
}
```

**Actions:**
- Records reset in `filter_resets` table
- Updates `device_states.last_reset_ts` to NOW()
- Resets `device_states.hours_used_total` to 0
- Resets `device_states.filter_hours_used` to 0
- Resets `devices.filter_usage_percent` to 0
- Optionally syncs to Bubble via webhook

**Response:**
```json
{
  "success": true,
  "message": "Filter reset recorded"
}
```

### 3. Get Filter Status
```http
GET /summaries/filter-status/:deviceKey
```

**Response:**
```json
{
  "ok": true,
  "filter_status": {
    "device_key": "workspace_id:device_id",
    "device_id": "device_id",
    "device_name": "Living Room Thermostat",
    "filter_target_hours": 1000,
    "filter_usage_percent": 23,
    "hours_used_total": 250.5,
    "filter_hours_used": 230.2,
    "hours_remaining": 769.8,
    "last_reset_date": "2025-01-15T10:30:00Z",
    "days_since_reset": 42,
    "estimated_days_remaining": 140,
    "use_forced_air_for_heat": true,
    "last_reset_user": "user_id",
    "last_reset_source": "manual"
  }
}
```

## Real-Time Calculation

### Session Stitcher Worker (runs every 5 minutes)

The `sessionStitcher` worker tracks equipment runtime and calculates filter usage in real-time using a **hybrid approach**:

#### Primary Method: Posted Runtime Data (Most Accurate)

When Bubble posts events with `runtime_seconds` and `previous_status`:

```json
{
  "equipment_status": "OFF",
  "previous_status": "Heating_Fan",
  "runtime_seconds": 1800,
  "timestamp": "2025-10-27T10:30:00Z"
}
```

The worker:
1. **Uses Posted Runtime** - Takes the device's actual runtime measurement (1800 seconds)
2. **Uses Previous Status** - Knows what the device WAS doing ("Heating_Fan")
3. **Creates Completed Session** - Immediately creates a finished session with accurate data
4. **Applies Filter Logic** - Checks if `previous_status` counts toward filter usage
5. **Updates Real-Time** - Updates all counters and percentages instantly

**Benefits:**
- ✅ Device-reported runtime (most accurate)
- ✅ No dependency on event timing
- ✅ Handles intermittent operation correctly
- ✅ Immediate processing (no 180-second tail delay)

#### Fallback Method: Time-Based Calculation

For events without `runtime_seconds`, falls back to transition tracking:
1. Tracks ON/OFF transitions from `equipment_events` table
2. Creates runtime sessions with equipment_status
3. Closes sessions after 180 seconds of inactivity
4. Calculates duration from timestamps: `ended_at - started_at`

**Calculation:**
```typescript
filter_usage_percent = Math.min(100, (filter_hours_used / filter_target_hours) * 100)
```

**Console Output:**
```
[sessionStitcher] Device workspace:device123: +0.50h total, +0.50h filter (Heating_Fan), usage: 23% [POSTED]
[sessionStitcher] Device workspace:device456: +0.15h total, +0.00h filter (excluded), usage: 18%
```

Note the `[POSTED]` tag indicates runtime was from device measurement (not calculated).

## Integration with Bubble

### From Bubble → Core

**Post Equipment Events with Runtime (Recommended):**
```javascript
// When equipment status changes and you have runtime data
POST https://core-api.com/ingest/v1/events:batch
{
  "events": [{
    "device_id": "device123",
    "equipment_status": "OFF",              // Current state
    "previous_status": "Heating_Fan",       // What it WAS doing
    "runtime_seconds": 1800,                // How long it ran
    "timestamp": "2025-10-27T10:30:00Z"
  }]
}
```

**Important:** Always include `previous_status` when posting `runtime_seconds`. This tells Core:
- `previous_status`: What the equipment was doing during the runtime period
- `runtime_seconds`: How long it ran in that previous state
- `equipment_status`: What the equipment is doing NOW (usually "OFF")

**Set Filter Target:**
```javascript
// When user changes filter in Bubble
POST https://core-api.com/v2/update-device
{
  "device_key": "workspace_id:device_id",
  "filter_target_hours": 1000  // User's new filter max runtime
}
```

**Reset Filter:**
```javascript
// When user replaces filter
POST https://core-api.com/filter-reset
{
  "device_id": "device_id",
  "user_id": "bubble_user_id",
  "source": "manual"
}
```

### From Core → Bubble (Optional)

Configure `BUBBLE_SYNC_URL` environment variable to receive filter reset notifications:

```javascript
// Core sends this to Bubble on filter reset
{
  "event": "filter_reset",
  "device_id": "device_id",
  "user_id": "user_id",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## Dashboard Display

Recommended dashboard display logic:

```typescript
// Fetch filter status
const response = await fetch(`/summaries/filter-status/${deviceKey}`);
const { filter_status } = await response.json();

// Display logic
const statusColor =
  filter_status.filter_usage_percent >= 90 ? "red" :
  filter_status.filter_usage_percent >= 70 ? "yellow" : "green";

const statusText =
  filter_status.filter_usage_percent >= 90 ? "Replace Soon" :
  filter_status.filter_usage_percent >= 70 ? "Monitor" : "Good";

// Show to user
console.log(`Filter: ${statusText} (${filter_status.filter_usage_percent}%)`);
console.log(`Usage: ${filter_status.filter_hours_used}h / ${filter_status.filter_target_hours}h`);
console.log(`Remaining: ~${filter_status.estimated_days_remaining} days`);
```

## Migration

Run the migration to add the `filter_hours_used` column:

```bash
npm run migrate
# or
node dist/runMigrations.js
```

Migration file: `src/db/migrations/005_add_filter_hours_tracking.sql`

## Troubleshooting

### Filter percentage not updating
- Check that `sessionStitcher` worker is running (every 5 minutes)
- Verify `equipment_status` values in `equipment_events` table
- Check `use_forced_air_for_heat` setting for device

### Filter reset not working
- Ensure both `device_id` and `user_id` are provided
- Check that device exists in `devices` table
- Verify `filter_resets` table has the new record

### Hours not counting toward filter
- Check `equipment_status` value (e.g., "Heating" vs "Heating_Fan")
- Verify `use_forced_air_for_heat` setting
- Review `countsTowardFilter()` logic in `sessionStitcher.ts:83-108`

## Implementation Files

- **Filter Reset**: `src/routes/filterReset.ts`
- **Device Update**: `src/routes/ingestV2.ts:136-181`
- **Session Tracking**: `src/workers/sessionStitcher.ts`
- **Filter Status API**: `src/routes/summaries.ts:103-183`
- **Migration**: `src/db/migrations/005_add_filter_hours_tracking.sql`
