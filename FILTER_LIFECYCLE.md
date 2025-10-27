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

The `sessionStitcher` worker tracks equipment runtime and calculates filter usage in real-time:

1. **Monitors Equipment Events**
   - Tracks ON/OFF transitions from `equipment_events` table
   - Creates runtime sessions with equipment_status

2. **Closes Runtime Sessions**
   - Closes sessions after 180 seconds of inactivity
   - Extracts `equipment_status` from session

3. **Determines Filter Usage**
   - Calls `countsTowardFilter(equipment_status, use_forced_air_for_heat)`
   - Calculates both total hours and filter-specific hours

4. **Updates Database**
   - Updates `device_states.hours_used_total`
   - Updates `device_states.filter_hours_used`
   - Calculates and updates `devices.filter_usage_percent`

**Calculation:**
```typescript
filter_usage_percent = Math.min(100, (filter_hours_used / filter_target_hours) * 100)
```

**Console Output:**
```
[sessionStitcher] Device workspace:device123: +0.25h total, +0.25h filter (Cooling_Fan), usage: 23%
[sessionStitcher] Device workspace:device456: +0.15h total, +0.00h filter (excluded), usage: 18%
```

## Integration with Bubble

### From Bubble → Core

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
