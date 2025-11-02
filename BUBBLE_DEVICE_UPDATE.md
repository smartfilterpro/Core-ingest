# Bubble to Core-Ingest: Device Configuration Update

## Endpoint

**PATCH** `/devices/:device_id`

Updates device configuration fields in the Core-Ingest database.

## Authentication

Include the Core API key or JWT token in the request headers:

**Option 1: API Key**
```
Authorization: Bearer YOUR_CORE_API_KEY
```

**Option 2: JWT Token**
```
Authorization: Bearer YOUR_JWT_TOKEN
```

Or:
```
X-Core-Token: YOUR_TOKEN
```

## URL Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `device_id` | string | The device identifier (can be `device_key` or `device_id`) |

## Request Body

All fields are optional. Include only the fields you want to update.

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `zip_prefix` | string | First 3 digits of ZIP code | `"100"` |
| `zip_code_prefix` | string | ZIP code prefix (same as zip_prefix) | `"100"` |
| `filter_target_hours` | number | Target filter life in hours | `100` |
| `use_forced_air_for_heat` | boolean | Whether device uses forced air for heating | `true` |
| `timezone` | string | IANA timezone identifier | `"America/New_York"` |

**Note:** At least ONE field must be provided in the request body.

## Example Requests

### Update All Fields

```bash
curl -X PATCH https://core-ingest-ingest.up.railway.app/devices/521795277786 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "zip_prefix": "100",
    "zip_code_prefix": "100",
    "filter_target_hours": 120,
    "use_forced_air_for_heat": true,
    "timezone": "America/New_York"
  }'
```

### Update Only Timezone and Filter Hours

```bash
curl -X PATCH https://core-ingest-ingest.up.railway.app/devices/521795277786 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "timezone": "America/Los_Angeles",
    "filter_target_hours": 150
  }'
```

### Update Only ZIP Prefix

```bash
curl -X PATCH https://core-ingest-ingest.up.railway.app/devices/521795277786 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "zip_prefix": "902",
    "zip_code_prefix": "902"
  }'
```

## Response Format

### Success Response (200 OK)

```json
{
  "ok": true,
  "device": {
    "device_id": "521795277786",
    "device_key": "521795277786",
    "device_name": "Living Room Thermostat",
    "zip_prefix": "100",
    "zip_code_prefix": "100",
    "filter_target_hours": 120,
    "use_forced_air_for_heat": true,
    "timezone": "America/New_York",
    "updated_at": "2025-11-02T12:34:56.789Z"
  },
  "updated_fields": [
    "zip_prefix",
    "zip_code_prefix",
    "filter_target_hours",
    "use_forced_air_for_heat",
    "timezone"
  ]
}
```

### Error Responses

**400 Bad Request - No Fields Provided**
```json
{
  "ok": false,
  "error": "At least one field must be provided: zip_prefix, filter_target_hours, use_forced_air_for_heat, zip_code_prefix, timezone"
}
```

**404 Not Found - Device Doesn't Exist**
```json
{
  "ok": false,
  "error": "Device not found"
}
```

**401 Unauthorized - Missing/Invalid Auth**
```json
{
  "ok": false,
  "error": "Missing Authorization"
}
```

**500 Internal Server Error**
```json
{
  "ok": false,
  "error": "Error message here"
}
```

## Bubble.io Integration

### API Connector Setup

1. **Plugin**: Use the API Connector plugin
2. **API Name**: Core Ingest API
3. **Add a new API call**:
   - **Name**: `Update Device Config`
   - **Use as**: Action
   - **Data type**: JSON
   - **Method**: PATCH
   - **URL**: `https://core-ingest-ingest.up.railway.app/devices/[device_id]`

4. **Parameters**:
   - `device_id` (path parameter, private)
   - Body parameters (all optional):
     - `zip_prefix` (optional)
     - `zip_code_prefix` (optional)
     - `filter_target_hours` (optional)
     - `use_forced_air_for_heat` (optional)
     - `timezone` (optional)

5. **Headers**:
   - `Authorization`: `Bearer [YOUR_CORE_API_KEY]`
   - `Content-Type`: `application/json`

### Workflow Example

**When user updates device settings:**

1. User fills out form with device configuration
2. Button click triggers workflow
3. Action: **Update Device Config**
   - device_id: `Current Device's device_id`
   - zip_prefix: `Input Zip's value`
   - filter_target_hours: `Input Filter Hours's value`
   - use_forced_air_for_heat: `Checkbox Forced Air's value`
   - timezone: `Dropdown Timezone's value`
4. Show success/error message based on response

## Common Timezone Values

- `America/New_York` - Eastern Time
- `America/Chicago` - Central Time
- `America/Denver` - Mountain Time
- `America/Los_Angeles` - Pacific Time
- `America/Phoenix` - Arizona (no DST)
- `America/Anchorage` - Alaska Time
- `Pacific/Honolulu` - Hawaii Time

## Notes

- **Partial Updates**: You can update any combination of fields. Only the fields in the request body will be updated.
- **Device Lookup**: The endpoint accepts both `device_key` and `device_id` for flexibility.
- **Validation**: The `updated_at` timestamp is automatically set to the current time.
- **CORS**: The endpoint has CORS enabled via the server's CORS middleware.
- **Idempotent**: Calling the endpoint multiple times with the same data is safe.

## Testing

Test the endpoint with curl or Postman before integrating with Bubble:

```bash
# Test with your actual device_id and API key
curl -X PATCH https://core-ingest-ingest.up.railway.app/devices/YOUR_DEVICE_ID \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"timezone": "America/New_York", "filter_target_hours": 100}'
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Check that your API key is correct and included in the Authorization header |
| 404 Not Found | Verify the device_id exists in the database |
| 400 Bad Request | Ensure at least one field is in the request body |
| CORS error | Check that the CORS middleware is enabled on the server |

## Support

For issues or questions, check the Core-Ingest logs or contact the development team.
