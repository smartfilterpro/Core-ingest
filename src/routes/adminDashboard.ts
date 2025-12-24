// routes/adminDashboard.ts
// Admin Dashboard API endpoints for analytics and user insights
import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// Apply authentication to all admin routes
router.use(requireAuth);

/**
 * GET /admin/stats/overview
 * Get high-level platform statistics
 */
router.get('/stats/overview', async (_req: Request, res: Response) => {
  try {
    const [usersResult, devicesResult, activeDevicesResult, eventsResult, sessionsResult] = await Promise.all([
      // Total unique users
      pool.query(`SELECT COUNT(DISTINCT user_id) as total_users FROM devices WHERE user_id IS NOT NULL`),

      // Total devices
      pool.query(`SELECT COUNT(*) as total_devices FROM devices`),

      // Active devices (seen in last 24h and 7d)
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '24 hours') as active_24h,
          COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '7 days') as active_7d
        FROM device_status
      `),

      // Total events (last 30 days)
      pool.query(`
        SELECT COUNT(*) as total_events
        FROM equipment_events
        WHERE recorded_at >= NOW() - INTERVAL '30 days'
      `),

      // Total sessions (last 30 days)
      pool.query(`
        SELECT
          COUNT(*) as total_sessions,
          SUM(duration_seconds) as total_runtime_seconds
        FROM runtime_sessions
        WHERE started_at >= NOW() - INTERVAL '30 days'
      `)
    ]);

    // Calculate average devices per user
    const totalUsers = parseInt(usersResult.rows[0]?.total_users || '0');
    const totalDevices = parseInt(devicesResult.rows[0]?.total_devices || '0');
    const avgDevicesPerUser = totalUsers > 0 ? (totalDevices / totalUsers).toFixed(2) : '0';

    res.json({
      ok: true,
      stats: {
        users: {
          total: totalUsers,
        },
        devices: {
          total: totalDevices,
          active_24h: parseInt(activeDevicesResult.rows[0]?.active_24h || '0'),
          active_7d: parseInt(activeDevicesResult.rows[0]?.active_7d || '0'),
          avg_per_user: parseFloat(avgDevicesPerUser),
        },
        activity: {
          events_last_30d: parseInt(eventsResult.rows[0]?.total_events || '0'),
          sessions_last_30d: parseInt(sessionsResult.rows[0]?.total_sessions || '0'),
          runtime_hours_last_30d: Math.round((parseInt(sessionsResult.rows[0]?.total_runtime_seconds || '0')) / 3600),
        },
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[admin/stats/overview] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/users/top
 * Get top users by device count, runtime, or activity
 */
router.get('/users/top', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sortBy = req.query.sort_by || 'device_count'; // device_count, runtime, activity

    let orderClause = 'device_count DESC';
    if (sortBy === 'runtime') {
      orderClause = 'total_runtime_hours DESC NULLS LAST';
    } else if (sortBy === 'activity') {
      orderClause = 'last_activity DESC NULLS LAST';
    }

    const { rows } = await pool.query(`
      WITH user_stats AS (
        SELECT
          d.user_id,
          COUNT(DISTINCT d.device_key) as device_count,
          COALESCE(SUM(ds.hours_used_total), 0) as total_runtime_hours,
          MAX(dst.last_seen_at) as last_activity,
          MODE() WITHIN GROUP (ORDER BY d.connection_source) as primary_thermostat_type,
          COUNT(DISTINCT d.connection_source) as thermostat_types_count,
          array_agg(DISTINCT d.connection_source) FILTER (WHERE d.connection_source IS NOT NULL) as thermostat_types
        FROM devices d
        LEFT JOIN device_states ds ON ds.device_key = d.device_key
        LEFT JOIN device_status dst ON dst.device_id = d.device_id
        WHERE d.user_id IS NOT NULL
        GROUP BY d.user_id
      ),
      user_resets AS (
        SELECT
          user_id,
          COUNT(*) as filter_resets_count
        FROM filter_resets
        GROUP BY user_id
      )
      SELECT
        us.user_id,
        us.device_count,
        ROUND(us.total_runtime_hours::numeric, 2) as total_runtime_hours,
        us.last_activity,
        us.primary_thermostat_type,
        us.thermostat_types_count,
        us.thermostat_types,
        COALESCE(ur.filter_resets_count, 0) as filter_resets_count
      FROM user_stats us
      LEFT JOIN user_resets ur ON ur.user_id = us.user_id
      ORDER BY ${orderClause}
      LIMIT $1
    `, [limit]);

    res.json({
      ok: true,
      count: rows.length,
      sort_by: sortBy,
      users: rows.map(row => ({
        user_id: row.user_id,
        device_count: parseInt(row.device_count),
        total_runtime_hours: parseFloat(row.total_runtime_hours) || 0,
        last_activity: row.last_activity,
        primary_thermostat_type: row.primary_thermostat_type,
        thermostat_types_count: parseInt(row.thermostat_types_count),
        thermostat_types: row.thermostat_types || [],
        filter_resets_count: parseInt(row.filter_resets_count),
      })),
    });
  } catch (err: any) {
    console.error('[admin/users/top] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/devices/by-source
 * Get device distribution by connection source (thermostat type)
 */
router.get('/devices/by-source', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(connection_source, 'unknown') as connection_source,
        COUNT(*) as device_count,
        COUNT(DISTINCT user_id) as user_count,
        ROUND(COUNT(*)::numeric * 100 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM devices
      GROUP BY connection_source
      ORDER BY device_count DESC
    `);

    const total = rows.reduce((sum, row) => sum + parseInt(row.device_count), 0);

    res.json({
      ok: true,
      total_devices: total,
      distribution: rows.map(row => ({
        source: row.connection_source,
        device_count: parseInt(row.device_count),
        user_count: parseInt(row.user_count),
        percentage: parseFloat(row.percentage),
      })),
    });
  } catch (err: any) {
    console.error('[admin/devices/by-source] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/devices/by-manufacturer
 * Get device distribution by manufacturer and model
 */
router.get('/devices/by-manufacturer', async (_req: Request, res: Response) => {
  try {
    // Manufacturer breakdown
    const manufacturerResult = await pool.query(`
      SELECT
        COALESCE(manufacturer, 'Unknown') as manufacturer,
        COUNT(*) as device_count,
        ROUND(COUNT(*)::numeric * 100 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM devices
      GROUP BY manufacturer
      ORDER BY device_count DESC
    `);

    // Top models
    const modelResult = await pool.query(`
      SELECT
        COALESCE(manufacturer, 'Unknown') as manufacturer,
        COALESCE(model, 'Unknown') as model,
        COUNT(*) as device_count
      FROM devices
      GROUP BY manufacturer, model
      ORDER BY device_count DESC
      LIMIT 20
    `);

    res.json({
      ok: true,
      manufacturers: manufacturerResult.rows.map(row => ({
        manufacturer: row.manufacturer,
        device_count: parseInt(row.device_count),
        percentage: parseFloat(row.percentage),
      })),
      top_models: modelResult.rows.map(row => ({
        manufacturer: row.manufacturer,
        model: row.model,
        device_count: parseInt(row.device_count),
      })),
    });
  } catch (err: any) {
    console.error('[admin/devices/by-manufacturer] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/regions/summary
 * Get geographic distribution and regional statistics
 */
router.get('/regions/summary', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    // Device distribution by region
    const regionDevicesResult = await pool.query(`
      SELECT
        COALESCE(zip_code_prefix, 'Unknown') as region,
        COUNT(*) as device_count,
        COUNT(DISTINCT user_id) as user_count
      FROM devices
      GROUP BY zip_code_prefix
      ORDER BY device_count DESC
      LIMIT $1
    `, [limit]);

    // Regional averages from region_averages table
    const regionAvgResult = await pool.query(`
      SELECT
        region_prefix,
        AVG(avg_runtime_seconds) as avg_daily_runtime_seconds,
        AVG(avg_temp) as avg_temperature,
        AVG(avg_humidity) as avg_humidity,
        SUM(sample_size) as total_samples
      FROM region_averages
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY region_prefix
      ORDER BY total_samples DESC
      LIMIT $1
    `, [limit]);

    res.json({
      ok: true,
      device_distribution: regionDevicesResult.rows.map(row => ({
        region: row.region,
        device_count: parseInt(row.device_count),
        user_count: parseInt(row.user_count),
      })),
      regional_averages: regionAvgResult.rows.map(row => ({
        region: row.region_prefix,
        avg_daily_runtime_hours: Math.round((parseFloat(row.avg_daily_runtime_seconds) || 0) / 3600 * 100) / 100,
        avg_temperature: row.avg_temperature ? Math.round(parseFloat(row.avg_temperature) * 10) / 10 : null,
        avg_humidity: row.avg_humidity ? Math.round(parseFloat(row.avg_humidity) * 10) / 10 : null,
        total_samples: parseInt(row.total_samples),
      })),
    });
  } catch (err: any) {
    console.error('[admin/regions/summary] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/usage/daily
 * Get daily usage trends (active devices, events, sessions)
 */
router.get('/usage/daily', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    const { rows } = await pool.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${days} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      ),
      daily_events AS (
        SELECT
          DATE(recorded_at) as date,
          COUNT(*) as event_count,
          COUNT(DISTINCT device_key) as devices_with_events
        FROM equipment_events
        WHERE recorded_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(recorded_at)
      ),
      daily_sessions AS (
        SELECT
          DATE(started_at) as date,
          COUNT(*) as session_count,
          SUM(duration_seconds) as total_runtime_seconds,
          COUNT(DISTINCT device_key) as devices_with_sessions
        FROM runtime_sessions
        WHERE started_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(started_at)
      ),
      daily_active AS (
        SELECT
          DATE(last_seen_at) as date,
          COUNT(DISTINCT device_id) as active_devices
        FROM device_status
        WHERE last_seen_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(last_seen_at)
      )
      SELECT
        ds.date,
        COALESCE(de.event_count, 0) as events,
        COALESCE(de.devices_with_events, 0) as devices_with_events,
        COALESCE(dss.session_count, 0) as sessions,
        COALESCE(dss.total_runtime_seconds, 0) as runtime_seconds,
        COALESCE(dss.devices_with_sessions, 0) as devices_with_sessions,
        COALESCE(da.active_devices, 0) as active_devices
      FROM date_series ds
      LEFT JOIN daily_events de ON de.date = ds.date
      LEFT JOIN daily_sessions dss ON dss.date = ds.date
      LEFT JOIN daily_active da ON da.date = ds.date
      ORDER BY ds.date DESC
    `);

    res.json({
      ok: true,
      days: days,
      trends: rows.map(row => ({
        date: row.date,
        events: parseInt(row.events),
        devices_with_events: parseInt(row.devices_with_events),
        sessions: parseInt(row.sessions),
        runtime_hours: Math.round(parseInt(row.runtime_seconds) / 3600 * 100) / 100,
        devices_with_sessions: parseInt(row.devices_with_sessions),
        active_devices: parseInt(row.active_devices),
      })),
    });
  } catch (err: any) {
    console.error('[admin/usage/daily] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/filters/health
 * Get filter lifecycle analytics
 */
router.get('/filters/health', async (_req: Request, res: Response) => {
  try {
    const [filterStatusResult, resetsResult, autoResetResult] = await Promise.all([
      // Devices by filter usage percentage buckets
      pool.query(`
        SELECT
          CASE
            WHEN filter_usage_percent >= 100 THEN 'overdue (100%+)'
            WHEN filter_usage_percent >= 80 THEN 'needs_attention (80-99%)'
            WHEN filter_usage_percent >= 50 THEN 'moderate (50-79%)'
            WHEN filter_usage_percent >= 20 THEN 'good (20-49%)'
            ELSE 'fresh (0-19%)'
          END as status_bucket,
          COUNT(*) as device_count
        FROM devices
        WHERE filter_usage_percent IS NOT NULL
        GROUP BY
          CASE
            WHEN filter_usage_percent >= 100 THEN 'overdue (100%+)'
            WHEN filter_usage_percent >= 80 THEN 'needs_attention (80-99%)'
            WHEN filter_usage_percent >= 50 THEN 'moderate (50-79%)'
            WHEN filter_usage_percent >= 20 THEN 'good (20-49%)'
            ELSE 'fresh (0-19%)'
          END
        ORDER BY
          CASE
            WHEN filter_usage_percent >= 100 THEN 1
            WHEN filter_usage_percent >= 80 THEN 2
            WHEN filter_usage_percent >= 50 THEN 3
            WHEN filter_usage_percent >= 20 THEN 4
            ELSE 5
          END
      `),

      // Filter reset trends (last 30 days)
      pool.query(`
        SELECT
          DATE(triggered_at) as date,
          source,
          COUNT(*) as reset_count
        FROM filter_resets
        WHERE triggered_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(triggered_at), source
        ORDER BY date DESC
      `),

      // Auto-reset settings
      pool.query(`
        SELECT
          auto_reset_at_115,
          COUNT(*) as device_count
        FROM devices
        GROUP BY auto_reset_at_115
      `)
    ]);

    // Process reset trends into daily summaries
    const resetsByDate = new Map<string, { manual: number; automatic: number }>();
    for (const row of resetsResult.rows) {
      const dateStr = row.date.toISOString().split('T')[0];
      if (!resetsByDate.has(dateStr)) {
        resetsByDate.set(dateStr, { manual: 0, automatic: 0 });
      }
      const entry = resetsByDate.get(dateStr)!;
      if (row.source === 'automatic') {
        entry.automatic += parseInt(row.reset_count);
      } else {
        entry.manual += parseInt(row.reset_count);
      }
    }

    const resetTrends = Array.from(resetsByDate.entries()).map(([date, counts]) => ({
      date,
      manual_resets: counts.manual,
      automatic_resets: counts.automatic,
      total_resets: counts.manual + counts.automatic,
    }));

    res.json({
      ok: true,
      filter_status_distribution: filterStatusResult.rows.map(row => ({
        status: row.status_bucket,
        device_count: parseInt(row.device_count),
      })),
      reset_trends: resetTrends,
      auto_reset_settings: autoResetResult.rows.map(row => ({
        auto_reset_enabled: row.auto_reset_at_115 === true,
        device_count: parseInt(row.device_count),
      })),
    });
  } catch (err: any) {
    console.error('[admin/filters/health] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/hvac/trends
 * Get HVAC mode distribution trends
 */
router.get('/hvac/trends', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    const { rows } = await pool.query(`
      SELECT
        date,
        SUM(runtime_seconds_heat) as heat_seconds,
        SUM(runtime_seconds_cool) as cool_seconds,
        SUM(runtime_seconds_fan) as fan_seconds,
        SUM(runtime_seconds_auxheat) as auxheat_seconds,
        SUM(runtime_seconds_mode_heat) as mode_heat_seconds,
        SUM(runtime_seconds_mode_cool) as mode_cool_seconds,
        SUM(runtime_seconds_mode_auto) as mode_auto_seconds,
        SUM(runtime_seconds_mode_eco) as mode_eco_seconds,
        COUNT(DISTINCT device_id) as device_count
      FROM summaries_daily
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY date
      ORDER BY date DESC
    `);

    res.json({
      ok: true,
      days: days,
      trends: rows.map(row => ({
        date: row.date,
        device_count: parseInt(row.device_count),
        hvac_mode_hours: {
          heat: Math.round(parseInt(row.heat_seconds || '0') / 3600 * 100) / 100,
          cool: Math.round(parseInt(row.cool_seconds || '0') / 3600 * 100) / 100,
          fan: Math.round(parseInt(row.fan_seconds || '0') / 3600 * 100) / 100,
          auxheat: Math.round(parseInt(row.auxheat_seconds || '0') / 3600 * 100) / 100,
        },
        thermostat_mode_hours: {
          heat: Math.round(parseInt(row.mode_heat_seconds || '0') / 3600 * 100) / 100,
          cool: Math.round(parseInt(row.mode_cool_seconds || '0') / 3600 * 100) / 100,
          auto: Math.round(parseInt(row.mode_auto_seconds || '0') / 3600 * 100) / 100,
          eco: Math.round(parseInt(row.mode_eco_seconds || '0') / 3600 * 100) / 100,
        },
      })),
    });
  } catch (err: any) {
    console.error('[admin/hvac/trends] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/workers/health
 * Get worker execution statistics
 */
router.get('/workers/health', async (_req: Request, res: Response) => {
  try {
    const [recentRunsResult, successRatesResult, lastRunsResult] = await Promise.all([
      // Recent worker runs
      pool.query(`
        SELECT
          worker_name,
          status,
          success,
          duration_seconds,
          devices_processed,
          success_count,
          fail_count,
          created_at
        FROM worker_runs
        ORDER BY created_at DESC
        LIMIT 50
      `),

      // Success rates by worker (last 7 days)
      pool.query(`
        SELECT
          worker_name,
          COUNT(*) as total_runs,
          COUNT(*) FILTER (WHERE success = true) as successful_runs,
          ROUND(COUNT(*) FILTER (WHERE success = true)::numeric * 100 / COUNT(*), 2) as success_rate,
          AVG(duration_seconds) as avg_duration_seconds
        FROM worker_runs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY worker_name
        ORDER BY worker_name
      `),

      // Last successful run per worker
      pool.query(`
        SELECT DISTINCT ON (worker_name)
          worker_name,
          created_at as last_run,
          duration_seconds,
          devices_processed,
          success_count,
          fail_count
        FROM worker_runs
        WHERE success = true
        ORDER BY worker_name, created_at DESC
      `)
    ]);

    res.json({
      ok: true,
      success_rates: successRatesResult.rows.map(row => ({
        worker: row.worker_name,
        total_runs: parseInt(row.total_runs),
        successful_runs: parseInt(row.successful_runs),
        success_rate_percent: parseFloat(row.success_rate),
        avg_duration_seconds: Math.round(parseFloat(row.avg_duration_seconds) || 0),
      })),
      last_successful_runs: lastRunsResult.rows.map(row => ({
        worker: row.worker_name,
        last_run: row.last_run,
        duration_seconds: parseFloat(row.duration_seconds),
        devices_processed: parseInt(row.devices_processed || '0'),
        success_count: parseInt(row.success_count || '0'),
        fail_count: parseInt(row.fail_count || '0'),
      })),
      recent_runs: recentRunsResult.rows.slice(0, 20).map(row => ({
        worker: row.worker_name,
        status: row.status,
        success: row.success,
        duration_seconds: parseFloat(row.duration_seconds),
        devices_processed: parseInt(row.devices_processed || '0'),
        created_at: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[admin/workers/health] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/data-quality
 * Get data quality and validation metrics
 */
router.get('/data-quality', async (_req: Request, res: Response) => {
  try {
    const [validationResult, coverageResult, discrepancyResult] = await Promise.all([
      // Validation stats (for Ecobee devices with ground truth)
      pool.query(`
        SELECT
          COUNT(*) as total_validated_days,
          COUNT(*) FILTER (WHERE is_corrected = true) as corrected_days,
          AVG(ABS(validation_discrepancy_seconds)) as avg_discrepancy_seconds
        FROM summaries_daily
        WHERE validated_runtime_seconds_heat IS NOT NULL
          OR validated_runtime_seconds_cool IS NOT NULL
      `),

      // Data coverage by date (last 14 days)
      pool.query(`
        SELECT
          date,
          COUNT(DISTINCT device_id) as devices_with_summaries,
          (SELECT COUNT(*) FROM devices) as total_devices,
          ROUND(COUNT(DISTINCT device_id)::numeric * 100 / NULLIF((SELECT COUNT(*) FROM devices), 0), 2) as coverage_percent
        FROM summaries_daily
        WHERE date >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY date
        ORDER BY date DESC
      `),

      // Devices with large discrepancies
      pool.query(`
        SELECT
          d.device_id,
          d.device_name,
          d.connection_source,
          COUNT(*) as days_with_discrepancy,
          AVG(ABS(s.validation_discrepancy_seconds)) as avg_discrepancy_seconds
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE ABS(s.validation_discrepancy_seconds) > 300
          AND s.date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY d.device_id, d.device_name, d.connection_source
        ORDER BY days_with_discrepancy DESC
        LIMIT 10
      `)
    ]);

    const validationStats = validationResult.rows[0];

    res.json({
      ok: true,
      validation: {
        total_validated_days: parseInt(validationStats?.total_validated_days || '0'),
        corrected_days: parseInt(validationStats?.corrected_days || '0'),
        avg_discrepancy_seconds: Math.round(parseFloat(validationStats?.avg_discrepancy_seconds || '0')),
        correction_rate_percent: validationStats?.total_validated_days > 0
          ? Math.round((parseInt(validationStats.corrected_days) / parseInt(validationStats.total_validated_days)) * 100)
          : 0,
      },
      daily_coverage: coverageResult.rows.map(row => ({
        date: row.date,
        devices_with_summaries: parseInt(row.devices_with_summaries),
        total_devices: parseInt(row.total_devices),
        coverage_percent: parseFloat(row.coverage_percent) || 0,
      })),
      devices_with_discrepancies: discrepancyResult.rows.map(row => ({
        device_id: row.device_id,
        device_name: row.device_name,
        connection_source: row.connection_source,
        days_with_discrepancy: parseInt(row.days_with_discrepancy),
        avg_discrepancy_minutes: Math.round(parseFloat(row.avg_discrepancy_seconds) / 60),
      })),
    });
  } catch (err: any) {
    console.error('[admin/data-quality] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/users/:userId
 * Get detailed information about a specific user
 */
router.get('/users/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const [userDevicesResult, userActivityResult, userResetsResult] = await Promise.all([
      // User's devices
      pool.query(`
        SELECT
          d.device_id,
          d.device_key,
          d.device_name,
          d.connection_source,
          d.manufacturer,
          d.model,
          d.filter_usage_percent,
          d.filter_target_hours,
          d.timezone,
          d.created_at,
          ds.hours_used_total,
          ds.filter_hours_used,
          dst.last_seen_at,
          dst.is_reachable
        FROM devices d
        LEFT JOIN device_states ds ON ds.device_key = d.device_key
        LEFT JOIN device_status dst ON dst.device_id = d.device_id
        WHERE d.user_id = $1
        ORDER BY d.created_at DESC
      `, [userId]),

      // User's recent activity (sessions)
      pool.query(`
        SELECT
          DATE(rs.started_at) as date,
          COUNT(*) as session_count,
          SUM(rs.duration_seconds) as runtime_seconds
        FROM runtime_sessions rs
        JOIN devices d ON d.device_key = rs.device_key
        WHERE d.user_id = $1
          AND rs.started_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(rs.started_at)
        ORDER BY date DESC
      `, [userId]),

      // User's filter resets
      pool.query(`
        SELECT
          fr.device_id,
          d.device_name,
          fr.source,
          fr.triggered_at
        FROM filter_resets fr
        JOIN devices d ON d.device_id = fr.device_id
        WHERE fr.user_id = $1
        ORDER BY fr.triggered_at DESC
        LIMIT 20
      `, [userId])
    ]);

    if (userDevicesResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found or has no devices' });
    }

    res.json({
      ok: true,
      user_id: userId,
      device_count: userDevicesResult.rows.length,
      devices: userDevicesResult.rows.map(row => ({
        device_id: row.device_id,
        device_key: row.device_key,
        device_name: row.device_name,
        connection_source: row.connection_source,
        manufacturer: row.manufacturer,
        model: row.model,
        filter_usage_percent: parseFloat(row.filter_usage_percent) || 0,
        filter_target_hours: parseInt(row.filter_target_hours) || 100,
        timezone: row.timezone,
        created_at: row.created_at,
        total_runtime_hours: parseFloat(row.hours_used_total) || 0,
        filter_runtime_hours: parseFloat(row.filter_hours_used) || 0,
        last_seen_at: row.last_seen_at,
        is_reachable: row.is_reachable,
      })),
      recent_activity: userActivityResult.rows.map(row => ({
        date: row.date,
        session_count: parseInt(row.session_count),
        runtime_hours: Math.round(parseInt(row.runtime_seconds) / 3600 * 100) / 100,
      })),
      recent_filter_resets: userResetsResult.rows.map(row => ({
        device_id: row.device_id,
        device_name: row.device_name,
        source: row.source,
        triggered_at: row.triggered_at,
      })),
    });
  } catch (err: any) {
    console.error('[admin/users/:userId] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
