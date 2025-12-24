# Admin Dashboard API Documentation

## Overview

The Admin Dashboard API provides endpoints for monitoring platform usage, understanding user behavior, and tracking system health. All endpoints require authentication and are designed to power an administrative interface.

## Authentication

All admin endpoints require authentication via one of these methods:

```
Authorization: Bearer <token>
```
or
```
X-Core-Token: <token>
```

The token can be either:
- A static `CORE_API_KEY` (for server-to-server calls)
- A JWT issued by Bubble.io (for authenticated admin users)

**Unauthorized requests return:**
```json
{ "error": "Unauthorized: missing core_token" }
```

---

## Endpoints

### 1. Platform Overview

#### `GET /admin/stats/overview`

High-level platform statistics for dashboard header cards.

**Response:**
```json
{
  "total_users": 150,
  "total_devices": 320,
  "active_devices_24h": 280,
  "total_runtime_hours": 12500.5,
  "avg_runtime_per_device": 39.06,
  "devices_with_predictions": 250,
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

**Suggested UI:** 4-6 stat cards at the top of the dashboard.

---

### 2. Top Users

#### `GET /admin/users/top`

Ranked list of users by engagement metrics.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max results (1-100) |
| `sort_by` | string | `device_count` | Sort field: `device_count`, `runtime`, `activity` |

**Response:**
```json
{
  "users": [
    {
      "user_id": "user_abc123",
      "email": null,
      "device_count": 5,
      "total_runtime_hours": 1250.5,
      "last_activity": "2024-01-15T08:30:00.000Z",
      "subscription_status": true
    }
  ]
}
```

**Suggested UI:** Sortable data table with columns for each metric.

---

### 3. User Details

#### `GET /admin/users/:userId`

Detailed information about a specific user.

**Response:**
```json
{
  "ok": true,
  "user_id": "user_abc123",
  "device_count": 3,
  "devices": [
    {
      "device_id": "dev_123",
      "device_key": "uuid-here",
      "device_name": "Living Room",
      "connection_source": "ecobee",
      "manufacturer": "ecobee",
      "model": "SmartThermostat",
      "filter_usage_percent": 65.5,
      "filter_target_hours": 100,
      "timezone": "America/New_York",
      "created_at": "2023-06-15T12:00:00.000Z",
      "total_runtime_hours": 450.25,
      "filter_runtime_hours": 320.5,
      "last_seen_at": "2024-01-15T08:30:00.000Z",
      "is_reachable": true
    }
  ],
  "recent_activity": [
    {
      "date": "2024-01-15",
      "session_count": 8,
      "runtime_hours": 4.5
    }
  ],
  "recent_filter_resets": [
    {
      "device_id": "dev_123",
      "device_name": "Living Room",
      "source": "manual",
      "triggered_at": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

**Suggested UI:** User detail modal or dedicated page with device cards and activity chart.

---

### 4. Thermostat Type Distribution

#### `GET /admin/devices/by-source`

Device breakdown by thermostat brand/platform.

**Response:**
```json
{
  "sources": [
    {
      "source": "ecobee",
      "count": 150,
      "percentage": 46.88
    },
    {
      "source": "nest",
      "count": 100,
      "percentage": 31.25
    }
  ],
  "total": 320
}
```

**Suggested UI:** Pie chart or donut chart with legend.

---

### 5. Manufacturer & Model Breakdown

#### `GET /admin/devices/by-manufacturer`

Device distribution by hardware manufacturer.

**Response:**
```json
{
  "manufacturers": [
    {
      "manufacturer": "ecobee",
      "count": 150,
      "percentage": 46.88
    },
    {
      "manufacturer": "Google",
      "count": 100,
      "percentage": 31.25
    }
  ],
  "total": 320
}
```

**Suggested UI:** Horizontal bar chart for manufacturers.

---

### 6. Geographic Distribution

#### `GET /admin/regions/summary`

Device distribution and usage patterns by region.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max regions to return |

**Response:**
```json
{
  "ok": true,
  "device_distribution": [
    {
      "region": "100",
      "device_count": 45,
      "user_count": 28
    },
    {
      "region": "902",
      "device_count": 32,
      "user_count": 20
    }
  ],
  "regional_averages": [
    {
      "region": "100",
      "avg_daily_runtime_hours": 6.5,
      "avg_temperature": 68.5,
      "avg_humidity": 42.3,
      "total_samples": 1250
    }
  ]
}
```

**Suggested UI:** Map visualization (if feasible) or ranked bar chart by region.

---

### 7. Daily Usage Trends

#### `GET /admin/usage/daily`

Time-series data for platform activity.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | number | 30 | Days of history (max 90) |

**Response:**
```json
{
  "data": [
    {
      "date": "2024-01-15",
      "active_devices": 290,
      "total_runtime_hours": 425.5,
      "avg_runtime_per_device": 1.47,
      "new_users": 5
    },
    {
      "date": "2024-01-14",
      "active_devices": 285,
      "total_runtime_hours": 410.25,
      "avg_runtime_per_device": 1.44,
      "new_users": 3
    }
  ],
  "period_days": 30
}
```

**Suggested UI:** Multi-line chart showing trends over time. Allow toggling between metrics.

---

### 8. Filter Health Analytics

#### `GET /admin/filters/health`

Filter lifecycle status across all devices.

**Response:**
```json
{
  "categories": [
    { "category": "Good (0-50%)", "count": 200, "percentage": 62.5 },
    { "category": "Warning (50-80%)", "count": 80, "percentage": 25 },
    { "category": "Critical (80%+)", "count": 40, "percentage": 12.5 }
  ],
  "total_devices": 320,
  "avg_filter_usage": 42.5
}
```

**Suggested UI:**
- Stacked bar chart or pie chart for filter status distribution
- Display average filter usage as a gauge

---

### 9. HVAC Mode Trends

#### `GET /admin/hvac/trends`

HVAC equipment mode usage over time.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | number | 30 | Days of history (max 90) |

**Response:**
```json
{
  "data": [
    {
      "date": "2024-01-15",
      "heat_hours": 850.5,
      "cool_hours": 120.25,
      "fan_hours": 45.0,
      "off_hours": 200.0
    }
  ],
  "period_days": 30
}
```

**Suggested UI:** Stacked area chart showing seasonal heating/cooling patterns.

---

### 10. Worker Health

#### `GET /admin/workers/health`

Background worker execution statistics.

**Response:**
```json
{
  "workers": [
    {
      "worker_name": "sessionStitcher",
      "status": "healthy",
      "last_heartbeat": "2024-01-15T10:00:00.000Z",
      "processed_count": 5000,
      "error_rate": 1.5
    },
    {
      "worker_name": "summaryWorker",
      "status": "healthy",
      "last_heartbeat": "2024-01-15T09:00:00.000Z",
      "processed_count": 320,
      "error_rate": 0
    }
  ],
  "overall_status": "healthy"
}
```

**Suggested UI:** Status cards per worker with health indicators and overall system status.

---

### 11. Data Quality

#### `GET /admin/data-quality`

Data validation and coverage metrics.

**Response:**
```json
{
  "coverage": {
    "devices_with_data": 280,
    "total_devices": 320,
    "percentage": 87.5
  },
  "freshness": {
    "updated_last_hour": 150,
    "updated_last_day": 280,
    "stale_devices": 40
  },
  "completeness": {
    "with_predictions": 250,
    "with_summaries": 280,
    "with_region_data": 200
  }
}
```

**Suggested UI:** Coverage percentage gauge, freshness indicators, and completeness breakdown.

---

## Frontend Implementation Notes

### Recommended Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: Platform Overview Cards (/admin/stats/overview)       │
│  [Users] [Devices] [Active 24h] [Runtime Hours]                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │ Thermostat Types     │  │ Usage Trends (30 days)           ││
│  │ Pie Chart            │  │ Line Chart                       ││
│  │ (/devices/by-source) │  │ (/usage/daily)                   ││
│  └──────────────────────┘  └──────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │ Filter Health        │  │ HVAC Mode Trends                 ││
│  │ Stacked Bar          │  │ Stacked Area Chart               ││
│  │ (/filters/health)    │  │ (/hvac/trends)                   ││
│  └──────────────────────┘  └──────────────────────────────────┘│
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Top Users Table (/users/top)                               ││
│  │ [User ID] [Devices] [Runtime] [Last Active] [Type] [Actions││
│  │ Click row → /users/:userId for detail modal                ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │ Worker Health        │  │ Data Quality                     ││
│  │ Status Cards         │  │ Coverage Chart                   ││
│  │ (/workers/health)    │  │ (/data-quality)                  ││
│  └──────────────────────┘  └──────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Chart Libraries

- **React:** Recharts, Nivo, or Chart.js with react-chartjs-2
- **Vue:** Vue-ChartJS or ApexCharts
- **Vanilla JS:** Chart.js or D3.js

### Refresh Strategy

| Data Type | Recommended Refresh |
|-----------|---------------------|
| Overview stats | Every 5 minutes |
| Usage trends | Every 15 minutes or on page load |
| Top users | On page load + manual refresh |
| Worker health | Every 1 minute (for monitoring) |
| Filter health | Every 15 minutes |

### Error Handling

All endpoints return consistent error format on failure:
```json
{
  "error": "Error message here"
}
```

Handle these HTTP status codes:
- `401` - Unauthorized (redirect to login)
- `404` - Resource not found
- `500` - Server error (show error message)

### TypeScript Types

```typescript
// GET /admin/stats/overview
interface AdminStatsOverview {
  total_users: number;
  total_devices: number;
  active_devices_24h: number;
  total_runtime_hours: number;
  avg_runtime_per_device: number;
  devices_with_predictions: number;
  updated_at: string;
}

// GET /admin/users/top
interface TopUser {
  user_id: string;
  email: string | null;
  device_count: number;
  total_runtime_hours: number;
  last_activity: string | null;
  subscription_status: boolean;
}

// GET /admin/devices/by-source
interface DeviceSource {
  source: string;
  count: number;
  percentage: number;
}

// GET /admin/devices/by-manufacturer
interface ManufacturerData {
  manufacturer: string;
  count: number;
  percentage: number;
}

// GET /admin/usage/daily
interface DailyUsage {
  date: string;
  active_devices: number;
  total_runtime_hours: number;
  avg_runtime_per_device: number;
  new_users: number;
}

// GET /admin/filters/health
interface FilterCategory {
  category: string;
  count: number;
  percentage: number;
}

// GET /admin/hvac/trends
interface HvacDay {
  date: string;
  heat_hours: number;
  cool_hours: number;
  fan_hours: number;
  off_hours: number;
}

// GET /admin/workers/health
interface WorkerStatus {
  worker_name: string;
  status: 'healthy' | 'degraded' | 'down';
  last_heartbeat: string | null;
  processed_count: number;
  error_rate: number;
}

// GET /admin/data-quality
interface DataQuality {
  coverage: {
    devices_with_data: number;
    total_devices: number;
    percentage: number;
  };
  freshness: {
    updated_last_hour: number;
    updated_last_day: number;
    stale_devices: number;
  };
  completeness: {
    with_predictions: number;
    with_summaries: number;
    with_region_data: number;
  };
}
```

---

## Base URL

Production: `https://your-api-domain.com`

All endpoints are prefixed with `/admin/`.

Example full URL: `https://your-api-domain.com/admin/stats/overview`
