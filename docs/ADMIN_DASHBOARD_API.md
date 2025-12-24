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
{ "ok": false, "error": "Unauthorized: missing core_token" }
```

---

## Endpoints

### 1. Platform Overview

#### `GET /admin/stats/overview`

High-level platform statistics for dashboard header cards.

**Response:**
```json
{
  "ok": true,
  "stats": {
    "users": {
      "total": 150
    },
    "devices": {
      "total": 320,
      "active_24h": 280,
      "active_7d": 310,
      "avg_per_user": 2.13
    },
    "activity": {
      "events_last_30d": 1200000,
      "sessions_last_30d": 45000,
      "runtime_hours_last_30d": 12500
    }
  },
  "generated_at": "2024-01-15T10:30:00.000Z"
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
  "ok": true,
  "count": 20,
  "sort_by": "device_count",
  "users": [
    {
      "user_id": "user_abc123",
      "device_count": 5,
      "total_runtime_hours": 1250.5,
      "last_activity": "2024-01-15T08:30:00.000Z",
      "primary_thermostat_type": "ecobee",
      "thermostat_types_count": 2,
      "thermostat_types": ["ecobee", "nest"],
      "filter_resets_count": 12
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
  "ok": true,
  "total_devices": 320,
  "distribution": [
    {
      "source": "ecobee",
      "device_count": 150,
      "user_count": 80,
      "percentage": 46.88
    },
    {
      "source": "nest",
      "device_count": 100,
      "user_count": 60,
      "percentage": 31.25
    },
    {
      "source": "resideo",
      "device_count": 40,
      "user_count": 25,
      "percentage": 12.5
    },
    {
      "source": "smartthings",
      "device_count": 20,
      "user_count": 15,
      "percentage": 6.25
    },
    {
      "source": "hubitat",
      "device_count": 10,
      "user_count": 8,
      "percentage": 3.12
    }
  ]
}
```

**Suggested UI:** Pie chart or donut chart with legend.

---

### 5. Manufacturer & Model Breakdown

#### `GET /admin/devices/by-manufacturer`

Device distribution by hardware manufacturer and model.

**Response:**
```json
{
  "ok": true,
  "manufacturers": [
    {
      "manufacturer": "ecobee",
      "device_count": 150,
      "percentage": 46.88
    },
    {
      "manufacturer": "Google",
      "device_count": 100,
      "percentage": 31.25
    }
  ],
  "top_models": [
    {
      "manufacturer": "ecobee",
      "model": "SmartThermostat Premium",
      "device_count": 80
    },
    {
      "manufacturer": "Google",
      "model": "Nest Learning Thermostat",
      "device_count": 60
    }
  ]
}
```

**Suggested UI:** Horizontal bar chart for manufacturers, table for top models.

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
  "ok": true,
  "days": 30,
  "trends": [
    {
      "date": "2024-01-15",
      "events": 45000,
      "devices_with_events": 280,
      "sessions": 1500,
      "runtime_hours": 425.5,
      "devices_with_sessions": 275,
      "active_devices": 290
    },
    {
      "date": "2024-01-14",
      "events": 42000,
      "devices_with_events": 275,
      "sessions": 1450,
      "runtime_hours": 410.25,
      "devices_with_sessions": 270,
      "active_devices": 285
    }
  ]
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
  "ok": true,
  "filter_status_distribution": [
    { "status": "overdue (100%+)", "device_count": 15 },
    { "status": "needs_attention (80-99%)", "device_count": 35 },
    { "status": "moderate (50-79%)", "device_count": 80 },
    { "status": "good (20-49%)", "device_count": 120 },
    { "status": "fresh (0-19%)", "device_count": 70 }
  ],
  "reset_trends": [
    {
      "date": "2024-01-15",
      "manual_resets": 5,
      "automatic_resets": 2,
      "total_resets": 7
    }
  ],
  "auto_reset_settings": [
    { "auto_reset_enabled": true, "device_count": 180 },
    { "auto_reset_enabled": false, "device_count": 140 }
  ]
}
```

**Suggested UI:**
- Stacked bar chart or pie chart for filter status distribution
- Line chart for reset trends
- Simple stat comparing auto-reset enabled vs disabled

---

### 9. HVAC Mode Trends

#### `GET /admin/hvac/trends`

HVAC equipment and thermostat mode usage over time.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | number | 30 | Days of history (max 90) |

**Response:**
```json
{
  "ok": true,
  "days": 30,
  "trends": [
    {
      "date": "2024-01-15",
      "device_count": 280,
      "hvac_mode_hours": {
        "heat": 850.5,
        "cool": 120.25,
        "fan": 45.0,
        "auxheat": 25.5
      },
      "thermostat_mode_hours": {
        "heat": 900.0,
        "cool": 50.0,
        "auto": 200.5,
        "eco": 80.25
      }
    }
  ]
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
  "ok": true,
  "success_rates": [
    {
      "worker": "sessionStitcher",
      "total_runs": 168,
      "successful_runs": 165,
      "success_rate_percent": 98.21,
      "avg_duration_seconds": 45
    },
    {
      "worker": "summaryWorker",
      "total_runs": 7,
      "successful_runs": 7,
      "success_rate_percent": 100.0,
      "avg_duration_seconds": 120
    }
  ],
  "last_successful_runs": [
    {
      "worker": "sessionStitcher",
      "last_run": "2024-01-15T10:00:00.000Z",
      "duration_seconds": 42,
      "devices_processed": 320,
      "success_count": 320,
      "fail_count": 0
    }
  ],
  "recent_runs": [
    {
      "worker": "sessionStitcher",
      "status": "completed",
      "success": true,
      "duration_seconds": 42,
      "devices_processed": 320,
      "created_at": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

**Suggested UI:** Status cards per worker with success rate gauges, plus a recent runs log table.

---

### 11. Data Quality

#### `GET /admin/data-quality`

Data validation and coverage metrics.

**Response:**
```json
{
  "ok": true,
  "validation": {
    "total_validated_days": 5000,
    "corrected_days": 150,
    "avg_discrepancy_seconds": 45,
    "correction_rate_percent": 3
  },
  "daily_coverage": [
    {
      "date": "2024-01-15",
      "devices_with_summaries": 280,
      "total_devices": 320,
      "coverage_percent": 87.5
    }
  ],
  "devices_with_discrepancies": [
    {
      "device_id": "dev_123",
      "device_name": "Living Room",
      "connection_source": "ecobee",
      "days_with_discrepancy": 5,
      "avg_discrepancy_minutes": 8
    }
  ]
}
```

**Suggested UI:** Coverage percentage gauge, line chart for daily coverage, and table for devices with issues.

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

All endpoints return consistent error format:
```json
{
  "ok": false,
  "error": "Error message here"
}
```

Handle these HTTP status codes:
- `401` - Unauthorized (redirect to login)
- `404` - Resource not found
- `500` - Server error (show error message)

### TypeScript Types

```typescript
interface AdminStatsOverview {
  ok: boolean;
  stats: {
    users: { total: number };
    devices: {
      total: number;
      active_24h: number;
      active_7d: number;
      avg_per_user: number;
    };
    activity: {
      events_last_30d: number;
      sessions_last_30d: number;
      runtime_hours_last_30d: number;
    };
  };
  generated_at: string;
}

interface TopUser {
  user_id: string;
  device_count: number;
  total_runtime_hours: number;
  last_activity: string | null;
  primary_thermostat_type: string | null;
  thermostat_types_count: number;
  thermostat_types: string[];
  filter_resets_count: number;
}

interface DeviceDistribution {
  source: string;
  device_count: number;
  user_count: number;
  percentage: number;
}

interface DailyTrend {
  date: string;
  events: number;
  devices_with_events: number;
  sessions: number;
  runtime_hours: number;
  devices_with_sessions: number;
  active_devices: number;
}

interface FilterStatusBucket {
  status: string;
  device_count: number;
}

interface HvacTrend {
  date: string;
  device_count: number;
  hvac_mode_hours: {
    heat: number;
    cool: number;
    fan: number;
    auxheat: number;
  };
  thermostat_mode_hours: {
    heat: number;
    cool: number;
    auto: number;
    eco: number;
  };
}

interface WorkerSuccessRate {
  worker: string;
  total_runs: number;
  successful_runs: number;
  success_rate_percent: number;
  avg_duration_seconds: number;
}
```

---

## Base URL

Production: `https://your-api-domain.com`

All endpoints are prefixed with `/admin/`.

Example full URL: `https://your-api-domain.com/admin/stats/overview`
