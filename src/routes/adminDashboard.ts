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
    const [usersResult, devicesResult, activeDevicesResult, runtimeResult, predictionsResult] = await Promise.all([
      // Total unique users
      pool.query(`SELECT COUNT(DISTINCT user_id) as total_users FROM devices WHERE user_id IS NOT NULL`),

      // Total devices
      pool.query(`SELECT COUNT(*) as total_devices FROM devices`),

      // Active devices (seen in last 24h)
      pool.query(`
        SELECT COUNT(*) as active_24h
        FROM device_status
        WHERE last_seen_at >= NOW() - INTERVAL '24 hours'
      `),

      // Total runtime hours and average
      pool.query(`
        SELECT
          COALESCE(SUM(hours_used_total), 0) as total_runtime_hours,
          COALESCE(AVG(hours_used_total), 0) as avg_runtime_per_device
        FROM device_states
      `),

      // Devices with predictions
      pool.query(`
        SELECT COUNT(DISTINCT device_id) as devices_with_predictions
        FROM ai_predictions
      `)
    ]);

    res.json({
      total_users: parseInt(usersResult.rows[0]?.total_users || '0'),
      total_devices: parseInt(devicesResult.rows[0]?.total_devices || '0'),
      active_devices_24h: parseInt(activeDevicesResult.rows[0]?.active_24h || '0'),
      total_runtime_hours: Math.round(parseFloat(runtimeResult.rows[0]?.total_runtime_hours || '0') * 100) / 100,
      avg_runtime_per_device: Math.round(parseFloat(runtimeResult.rows[0]?.avg_runtime_per_device || '0') * 100) / 100,
      devices_with_predictions: parseInt(predictionsResult.rows[0]?.devices_with_predictions || '0'),
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[admin/stats/overview] Error:', err.message);
    res.status(500).json({ error: err.message });
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
      SELECT
        d.user_id,
        COUNT(DISTINCT d.device_key) as device_count,
        COALESCE(SUM(ds.hours_used_total), 0) as total_runtime_hours,
        MAX(dst.last_seen_at) as last_activity
      FROM devices d
      LEFT JOIN device_states ds ON ds.device_key = d.device_key
      LEFT JOIN device_status dst ON dst.device_key = d.device_key
      WHERE d.user_id IS NOT NULL
      GROUP BY d.user_id
      ORDER BY ${orderClause}
      LIMIT $1
    `, [limit]);

    res.json({
      users: rows.map(row => ({
        user_id: row.user_id,
        email: null, // Email not stored in core-ingest
        device_count: parseInt(row.device_count),
        total_runtime_hours: Math.round(parseFloat(row.total_runtime_hours || '0') * 100) / 100,
        last_activity: row.last_activity ? row.last_activity.toISOString() : null,
        subscription_status: true, // Subscription managed externally
      })),
    });
  } catch (err: any) {
    console.error('[admin/users/top] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/users/:userId
 * Get detailed information about a specific user
 */
router.get('/users/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const [userDevicesResult, userActivityResult] = await Promise.all([
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
        LEFT JOIN device_status dst ON dst.device_key = d.device_key
        WHERE d.user_id = $1
        ORDER BY d.created_at DESC
      `, [userId]),

      // User's recent activity (sessions)
      pool.query(`
        SELECT
          DATE(rs.started_at) as date,
          COUNT(*) as session_count,
          SUM(rs.runtime_seconds) as runtime_seconds
        FROM runtime_sessions rs
        JOIN devices d ON d.device_key = rs.device_key
        WHERE d.user_id = $1
          AND rs.started_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(rs.started_at)
        ORDER BY date DESC
      `, [userId])
    ]);

    if (userDevicesResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or has no devices' });
    }

    res.json({
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
    });
  } catch (err: any) {
    console.error('[admin/users/:userId] Error:', err.message);
    res.status(500).json({ error: err.message });
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
        COALESCE(connection_source, 'unknown') as source,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric * 100 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as percentage
      FROM devices
      GROUP BY connection_source
      ORDER BY count DESC
    `);

    const total = rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    res.json({
      sources: rows.map(row => ({
        source: row.source,
        count: parseInt(row.count),
        percentage: parseFloat(row.percentage) || 0,
      })),
      total,
    });
  } catch (err: any) {
    console.error('[admin/devices/by-source] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/devices/by-manufacturer
 * Get device distribution by manufacturer
 */
router.get('/devices/by-manufacturer', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(manufacturer, 'Unknown') as manufacturer,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric * 100 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as percentage
      FROM devices
      GROUP BY manufacturer
      ORDER BY count DESC
    `);

    const total = rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    res.json({
      manufacturers: rows.map(row => ({
        manufacturer: row.manufacturer,
        count: parseInt(row.count),
        percentage: parseFloat(row.percentage) || 0,
      })),
      total,
    });
  } catch (err: any) {
    console.error('[admin/devices/by-manufacturer] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/regions/summary
 * Get geographic distribution and regional statistics
 */
router.get('/regions/summary', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { rows } = await pool.query(`
      SELECT
        COALESCE(zip_code_prefix, 'Unknown') as region,
        COUNT(*) as device_count,
        COUNT(DISTINCT user_id) as user_count
      FROM devices
      GROUP BY zip_code_prefix
      ORDER BY device_count DESC
      LIMIT $1
    `, [limit]);

    res.json({
      regions: rows.map(row => ({
        region: row.region,
        device_count: parseInt(row.device_count),
        user_count: parseInt(row.user_count),
      })),
    });
  } catch (err: any) {
    console.error('[admin/regions/summary] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/usage/daily
 * Get daily usage trends
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
      daily_active AS (
        SELECT
          DATE(last_seen_at) as date,
          COUNT(DISTINCT device_key) as active_devices
        FROM device_status
        WHERE last_seen_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(last_seen_at)
      ),
      daily_runtime AS (
        SELECT
          DATE(started_at) as date,
          SUM(runtime_seconds) / 3600.0 as total_runtime_hours,
          COUNT(DISTINCT device_key) as devices_with_runtime
        FROM runtime_sessions
        WHERE started_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(started_at)
      ),
      daily_new_users AS (
        SELECT
          DATE(MIN(created_at)) as date,
          COUNT(DISTINCT user_id) as new_users
        FROM devices
        WHERE user_id IS NOT NULL
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
      ),
      new_users_by_date AS (
        SELECT date, SUM(new_users) as new_users
        FROM daily_new_users
        GROUP BY date
      )
      SELECT
        ds.date,
        COALESCE(da.active_devices, 0) as active_devices,
        COALESCE(dr.total_runtime_hours, 0) as total_runtime_hours,
        CASE
          WHEN COALESCE(da.active_devices, 0) > 0
          THEN COALESCE(dr.total_runtime_hours, 0) / da.active_devices
          ELSE 0
        END as avg_runtime_per_device,
        COALESCE(nu.new_users, 0) as new_users
      FROM date_series ds
      LEFT JOIN daily_active da ON da.date = ds.date
      LEFT JOIN daily_runtime dr ON dr.date = ds.date
      LEFT JOIN new_users_by_date nu ON nu.date = ds.date
      ORDER BY ds.date ASC
    `);

    res.json({
      data: rows.map(row => ({
        date: row.date.toISOString().split('T')[0],
        active_devices: parseInt(row.active_devices),
        total_runtime_hours: Math.round(parseFloat(row.total_runtime_hours) * 100) / 100,
        avg_runtime_per_device: Math.round(parseFloat(row.avg_runtime_per_device) * 100) / 100,
        new_users: parseInt(row.new_users),
      })),
      period_days: days,
    });
  } catch (err: any) {
    console.error('[admin/usage/daily] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/filters/health
 * Get filter lifecycle analytics
 */
router.get('/filters/health', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        CASE
          WHEN filter_usage_percent >= 80 THEN 'Critical (80%+)'
          WHEN filter_usage_percent >= 50 THEN 'Warning (50-80%)'
          ELSE 'Good (0-50%)'
        END as category,
        COUNT(*) as count
      FROM devices
      WHERE filter_usage_percent IS NOT NULL
      GROUP BY
        CASE
          WHEN filter_usage_percent >= 80 THEN 'Critical (80%+)'
          WHEN filter_usage_percent >= 50 THEN 'Warning (50-80%)'
          ELSE 'Good (0-50%)'
        END
    `);

    const totalDevices = rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    // Get average filter usage
    const avgResult = await pool.query(`
      SELECT AVG(filter_usage_percent) as avg_usage
      FROM devices
      WHERE filter_usage_percent IS NOT NULL
    `);

    // Ensure all categories exist
    const categoryMap: Record<string, number> = {
      'Good (0-50%)': 0,
      'Warning (50-80%)': 0,
      'Critical (80%+)': 0,
    };

    rows.forEach(row => {
      categoryMap[row.category] = parseInt(row.count);
    });

    const categories = Object.entries(categoryMap).map(([category, count]) => ({
      category,
      count,
      percentage: totalDevices > 0 ? Math.round((count / totalDevices) * 100 * 100) / 100 : 0,
    }));

    res.json({
      categories,
      total_devices: totalDevices,
      avg_filter_usage: Math.round(parseFloat(avgResult.rows[0]?.avg_usage || '0') * 100) / 100,
    });
  } catch (err: any) {
    console.error('[admin/filters/health] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/filters/due-soon
 * Get devices with filters predicted to need replacement within specified days
 */
router.get('/filters/due-soon', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);

    // Check if ai_predictions table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ai_predictions'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      return res.json({
        filters: [],
        total_count: 0,
      });
    }

    const { rows } = await pool.query(`
      SELECT
        p.device_id,
        d.device_name,
        COALESCE(d.user_id, d.workspace_id) as user_id,
        CAST(p.predicted_usage_percent AS FLOAT) as filter_usage_percent,
        p.predicted_days_remaining,
        (CURRENT_DATE + INTERVAL '1 day' * p.predicted_days_remaining) as predicted_change_date,
        COALESCE(dst.last_seen_at, d.updated_at) as last_activity
      FROM ai_predictions p
      JOIN devices d ON p.device_id = d.device_id
      LEFT JOIN device_status dst ON dst.device_key = d.device_key
      WHERE p.predicted_days_remaining <= $1
        AND p.predicted_days_remaining >= 0
        AND p.created_at = (
          SELECT MAX(created_at)
          FROM ai_predictions
          WHERE device_id = p.device_id
        )
      ORDER BY p.predicted_days_remaining ASC
      LIMIT 100
    `, [days]);

    res.json({
      filters: rows.map(row => ({
        device_id: row.device_id,
        device_name: row.device_name,
        user_id: row.user_id,
        user_email: null, // Email not stored in core-ingest, managed by Bubble
        filter_usage_percent: Math.round(parseFloat(row.filter_usage_percent || '0') * 100) / 100,
        predicted_days_remaining: parseInt(row.predicted_days_remaining),
        predicted_change_date: row.predicted_change_date?.toISOString() || null,
        last_activity: row.last_activity?.toISOString() || null,
      })),
      total_count: rows.length,
    });
  } catch (err: any) {
    console.error('[admin/filters/due-soon] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/hvac/trends
 * Get HVAC mode distribution trends
 *
 * Mode breakdown from runtime_sessions:
 * - heat_hours: Heating runtime
 * - cool_hours: Cooling runtime
 * - fan_hours: Fan-only runtime
 * - auxheat_hours: Auxiliary/emergency heat runtime
 * - unknown_hours: Sessions with unrecognized mode (data quality indicator)
 */
router.get('/hvac/trends', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    const { rows } = await pool.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${days} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      )
      SELECT
        ds.date,
        COALESCE(SUM(sd.runtime_seconds_heat), 0) / 3600.0 as heat_hours,
        COALESCE(SUM(sd.runtime_seconds_cool), 0) / 3600.0 as cool_hours,
        COALESCE(SUM(sd.runtime_seconds_fan), 0) / 3600.0 as fan_hours,
        COALESCE(SUM(sd.runtime_seconds_auxheat), 0) / 3600.0 as auxheat_hours,
        COALESCE(SUM(sd.runtime_seconds_unknown), 0) / 3600.0 as unknown_hours,
        COALESCE(SUM(sd.runtime_seconds_total), 0) / 3600.0 as total_hours
      FROM date_series ds
      LEFT JOIN summaries_daily sd ON sd.date = ds.date
      GROUP BY ds.date
      ORDER BY ds.date ASC
    `);

    res.json({
      data: rows.map(row => ({
        date: row.date.toISOString().split('T')[0],
        heat_hours: Math.max(0, Math.round(parseFloat(row.heat_hours) * 100) / 100),
        cool_hours: Math.max(0, Math.round(parseFloat(row.cool_hours) * 100) / 100),
        fan_hours: Math.max(0, Math.round(parseFloat(row.fan_hours) * 100) / 100),
        auxheat_hours: Math.max(0, Math.round(parseFloat(row.auxheat_hours) * 100) / 100),
        unknown_hours: Math.max(0, Math.round(parseFloat(row.unknown_hours) * 100) / 100),
        total_hours: Math.max(0, Math.round(parseFloat(row.total_hours) * 100) / 100),
      })),
      period_days: days,
    });
  } catch (err: any) {
    console.error('[admin/hvac/trends] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/workers/health
 * Get worker execution statistics
 */
router.get('/workers/health', async (_req: Request, res: Response) => {
  try {
    // Check if worker_runs table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'worker_runs'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      // Return default response if table doesn't exist
      return res.json({
        workers: [],
        overall_status: 'healthy',
      });
    }

    const { rows } = await pool.query(`
      WITH worker_stats AS (
        SELECT
          worker_name,
          MAX(created_at) as last_heartbeat,
          COUNT(*) as total_runs,
          COUNT(*) FILTER (WHERE success = true) as successful_runs,
          SUM(COALESCE(devices_processed, 0)) as processed_count
        FROM worker_runs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY worker_name
      )
      SELECT
        worker_name,
        last_heartbeat,
        processed_count,
        CASE
          WHEN total_runs = 0 THEN 0
          ELSE ROUND((total_runs - successful_runs)::numeric * 100 / total_runs, 2)
        END as error_rate,
        CASE
          WHEN last_heartbeat >= NOW() - INTERVAL '1 hour' THEN 'healthy'
          WHEN last_heartbeat >= NOW() - INTERVAL '6 hours' THEN 'degraded'
          ELSE 'down'
        END as status
      FROM worker_stats
      ORDER BY worker_name
    `);

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    for (const row of rows) {
      if (row.status === 'down') {
        overallStatus = 'down';
        break;
      } else if (row.status === 'degraded') {
        overallStatus = 'degraded';
      }
    }

    res.json({
      workers: rows.map(row => ({
        worker_name: row.worker_name,
        status: row.status as 'healthy' | 'degraded' | 'down',
        last_heartbeat: row.last_heartbeat?.toISOString() || null,
        processed_count: parseInt(row.processed_count) || 0,
        error_rate: parseFloat(row.error_rate) || 0,
      })),
      overall_status: overallStatus,
    });
  } catch (err: any) {
    console.error('[admin/workers/health] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/data-quality
 * Get data quality and validation metrics
 */
router.get('/data-quality', async (_req: Request, res: Response) => {
  try {
    const [coverageResult, freshnessResult, completenessResult] = await Promise.all([
      // Coverage: devices with data
      pool.query(`
        SELECT
          COUNT(DISTINCT ds.device_key) as devices_with_data,
          (SELECT COUNT(*) FROM devices) as total_devices
        FROM device_states ds
        WHERE ds.hours_used_total > 0
      `),

      // Freshness: device activity recency
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '1 hour') as updated_last_hour,
          COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '24 hours') as updated_last_day,
          COUNT(*) FILTER (WHERE last_seen_at < NOW() - INTERVAL '7 days' OR last_seen_at IS NULL) as stale_devices
        FROM device_status
      `),

      // Completeness: devices with various data types
      pool.query(`
        SELECT
          (SELECT COUNT(DISTINCT device_id) FROM ai_predictions) as with_predictions,
          (SELECT COUNT(DISTINCT device_id) FROM summaries_daily) as with_summaries,
          (SELECT COUNT(DISTINCT d.device_id) FROM devices d WHERE d.zip_code_prefix IS NOT NULL) as with_region_data
      `)
    ]);

    const devicesWithData = parseInt(coverageResult.rows[0]?.devices_with_data || '0');
    const totalDevices = parseInt(coverageResult.rows[0]?.total_devices || '0');

    res.json({
      coverage: {
        devices_with_data: devicesWithData,
        total_devices: totalDevices,
        percentage: totalDevices > 0 ? Math.round((devicesWithData / totalDevices) * 100 * 100) / 100 : 0,
      },
      freshness: {
        updated_last_hour: parseInt(freshnessResult.rows[0]?.updated_last_hour || '0'),
        updated_last_day: parseInt(freshnessResult.rows[0]?.updated_last_day || '0'),
        stale_devices: parseInt(freshnessResult.rows[0]?.stale_devices || '0'),
      },
      completeness: {
        with_predictions: parseInt(completenessResult.rows[0]?.with_predictions || '0'),
        with_summaries: parseInt(completenessResult.rows[0]?.with_summaries || '0'),
        with_region_data: parseInt(completenessResult.rows[0]?.with_region_data || '0'),
      },
    });
  } catch (err: any) {
    console.error('[admin/data-quality] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/runtime/reconcile/:deviceId
 * Compare runtime data from different sources to identify discrepancies
 * Helps debug differences between filter_hours_used and summaries
 */
router.get('/runtime/reconcile/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Get device info and real-time state
    const deviceResult = await pool.query(`
      SELECT
        d.device_id,
        d.device_key,
        d.device_name,
        d.use_forced_air_for_heat,
        d.filter_target_hours,
        d.filter_usage_percent,
        d.timezone,
        ds.hours_used_total,
        ds.filter_hours_used,
        ds.last_reset_ts,
        ds.last_event_ts
      FROM devices d
      LEFT JOIN device_states ds ON ds.device_key = d.device_key
      WHERE d.device_id = $1
    `, [deviceId]);

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceResult.rows[0];
    const lastResetTs = device.last_reset_ts;

    // Get runtime from summaries_daily (since last reset if available)
    const summariesResult = await pool.query(`
      SELECT
        COUNT(*) as days_count,
        MIN(date) as first_date,
        MAX(date) as last_date,
        SUM(runtime_seconds_total) / 3600.0 as total_hours,
        SUM(runtime_seconds_heat) / 3600.0 as heat_hours,
        SUM(runtime_seconds_cool) / 3600.0 as cool_hours,
        SUM(runtime_seconds_fan) / 3600.0 as fan_hours,
        SUM(runtime_seconds_auxheat) / 3600.0 as auxheat_hours,
        SUM(runtime_seconds_unknown) / 3600.0 as unknown_hours
      FROM summaries_daily
      WHERE device_id = $1
        ${lastResetTs ? `AND date >= $2::date` : ''}
    `, lastResetTs ? [deviceId, lastResetTs] : [deviceId]);

    // Get runtime directly from runtime_sessions (since last reset if available)
    const sessionsResult = await pool.query(`
      SELECT
        COUNT(*) as session_count,
        MIN(started_at) as first_session,
        MAX(ended_at) as last_session,
        SUM(runtime_seconds) / 3600.0 as total_hours,
        SUM(CASE WHEN mode = 'heat' THEN runtime_seconds ELSE 0 END) / 3600.0 as heat_hours,
        SUM(CASE WHEN mode = 'cool' THEN runtime_seconds ELSE 0 END) / 3600.0 as cool_hours,
        SUM(CASE WHEN mode = 'fan' THEN runtime_seconds ELSE 0 END) / 3600.0 as fan_hours,
        SUM(CASE WHEN mode = 'auxheat' THEN runtime_seconds ELSE 0 END) / 3600.0 as auxheat_hours,
        SUM(CASE WHEN mode NOT IN ('heat', 'cool', 'fan', 'auxheat') OR mode IS NULL THEN runtime_seconds ELSE 0 END) / 3600.0 as unknown_hours
      FROM runtime_sessions
      WHERE device_key = $1
        AND ended_at IS NOT NULL
        ${lastResetTs ? `AND ended_at >= $2` : ''}
    `, lastResetTs ? [device.device_key, lastResetTs] : [device.device_key]);

    // Calculate expected filter hours based on sessions and use_forced_air_for_heat
    const filterCalcResult = await pool.query(`
      SELECT
        SUM(
          CASE
            WHEN LOWER(equipment_status) LIKE '%cool%' OR LOWER(equipment_status) LIKE '%fan%' THEN runtime_seconds
            WHEN LOWER(equipment_status) LIKE '%heat%' AND $2 = true THEN runtime_seconds
            WHEN LOWER(equipment_status) LIKE '%heat%' AND (LOWER(equipment_status) LIKE '%_fan%' OR LOWER(equipment_status) LIKE '%fan') THEN runtime_seconds
            ELSE 0
          END
        ) / 3600.0 as calculated_filter_hours
      FROM runtime_sessions
      WHERE device_key = $1
        AND ended_at IS NOT NULL
        ${lastResetTs ? `AND ended_at >= $3` : ''}
    `, lastResetTs
      ? [device.device_key, device.use_forced_air_for_heat, lastResetTs]
      : [device.device_key, device.use_forced_air_for_heat]);

    // Check for today's sessions not yet in summaries
    const todayResult = await pool.query(`
      SELECT
        COUNT(*) as session_count,
        SUM(runtime_seconds) / 3600.0 as total_hours
      FROM runtime_sessions
      WHERE device_key = $1
        AND ended_at IS NOT NULL
        AND DATE(ended_at AT TIME ZONE COALESCE($2, 'UTC')) = CURRENT_DATE
    `, [device.device_key, device.timezone]);

    // Check last summary date
    const lastSummaryResult = await pool.query(`
      SELECT MAX(date) as last_summary_date
      FROM summaries_daily
      WHERE device_id = $1
    `, [deviceId]);

    // Find days with sessions but no summaries (missing days)
    const missingDaysQuery = lastResetTs
      ? `
        WITH session_dates AS (
          SELECT DISTINCT DATE(ended_at AT TIME ZONE COALESCE($2, 'UTC')) as date,
                 SUM(runtime_seconds) / 3600.0 as hours
          FROM runtime_sessions
          WHERE device_key = $1
            AND ended_at IS NOT NULL
            AND ended_at >= $3
          GROUP BY DATE(ended_at AT TIME ZONE COALESCE($2, 'UTC'))
        ),
        summary_dates AS (
          SELECT date FROM summaries_daily WHERE device_id = $4
        )
        SELECT sd.date, sd.hours
        FROM session_dates sd
        LEFT JOIN summary_dates sum ON sum.date = sd.date
        WHERE sum.date IS NULL
        ORDER BY sd.date DESC
        LIMIT 20
      `
      : `
        WITH session_dates AS (
          SELECT DISTINCT DATE(ended_at AT TIME ZONE COALESCE($2, 'UTC')) as date,
                 SUM(runtime_seconds) / 3600.0 as hours
          FROM runtime_sessions
          WHERE device_key = $1
            AND ended_at IS NOT NULL
          GROUP BY DATE(ended_at AT TIME ZONE COALESCE($2, 'UTC'))
        ),
        summary_dates AS (
          SELECT date FROM summaries_daily WHERE device_id = $3
        )
        SELECT sd.date, sd.hours
        FROM session_dates sd
        LEFT JOIN summary_dates sum ON sum.date = sd.date
        WHERE sum.date IS NULL
        ORDER BY sd.date DESC
        LIMIT 20
      `;

    const missingDaysResult = await pool.query(
      missingDaysQuery,
      lastResetTs
        ? [device.device_key, device.timezone, lastResetTs, deviceId]
        : [device.device_key, device.timezone, deviceId]
    );

    // Find dates with sessions but no equipment_events (root cause of summary gaps)
    const noEventsQuery = `
      WITH session_dates AS (
        SELECT
          DATE(rs.ended_at AT TIME ZONE COALESCE($2, 'UTC')) as date,
          SUM(rs.runtime_seconds) / 3600.0 as session_hours,
          COUNT(*) as session_count
        FROM runtime_sessions rs
        WHERE rs.device_key = $1
          AND rs.ended_at IS NOT NULL
        GROUP BY DATE(rs.ended_at AT TIME ZONE COALESCE($2, 'UTC'))
      ),
      event_dates AS (
        SELECT DISTINCT DATE(ee.recorded_at AT TIME ZONE COALESCE($2, 'UTC')) as date
        FROM equipment_events ee
        WHERE ee.device_key = $1
      ),
      summary_runtime AS (
        SELECT date, runtime_seconds_total / 3600.0 as summary_hours
        FROM summaries_daily
        WHERE device_id = $3
      )
      SELECT
        sd.date,
        sd.session_hours,
        sd.session_count,
        COALESCE(sr.summary_hours, 0) as summary_hours,
        sd.session_hours - COALESCE(sr.summary_hours, 0) as hours_lost,
        CASE WHEN ed.date IS NULL THEN true ELSE false END as no_equipment_events
      FROM session_dates sd
      LEFT JOIN event_dates ed ON ed.date = sd.date
      LEFT JOIN summary_runtime sr ON sr.date = sd.date
      WHERE sd.session_hours - COALESCE(sr.summary_hours, 0) > 0.01
      ORDER BY sd.date DESC
      LIMIT 30
    `;

    const noEventsResult = await pool.query(noEventsQuery, [device.device_key, device.timezone, deviceId]);

    const summaries = summariesResult.rows[0];
    const sessions = sessionsResult.rows[0];
    const filterCalc = filterCalcResult.rows[0];
    const today = todayResult.rows[0];
    const lastSummary = lastSummaryResult.rows[0];
    const missingDays = missingDaysResult.rows;
    const datesWithLostHours = noEventsResult.rows;

    // Calculate discrepancies
    const realTimeFilterHours = parseFloat(device.filter_hours_used) || 0;
    const realTimeTotalHours = parseFloat(device.hours_used_total) || 0;
    const summaryTotalHours = parseFloat(summaries.total_hours) || 0;
    const sessionTotalHours = parseFloat(sessions.total_hours) || 0;
    const calculatedFilterHours = parseFloat(filterCalc.calculated_filter_hours) || 0;
    const todayHours = parseFloat(today.total_hours) || 0;

    res.json({
      device: {
        device_id: device.device_id,
        device_name: device.device_name,
        timezone: device.timezone,
        use_forced_air_for_heat: device.use_forced_air_for_heat,
        last_reset_ts: device.last_reset_ts,
        last_event_ts: device.last_event_ts,
      },

      // Real-time values from device_states (authoritative)
      real_time: {
        filter_hours_used: Math.round(realTimeFilterHours * 100) / 100,
        hours_used_total: Math.round(realTimeTotalHours * 100) / 100,
        source: 'device_states (updated by sessionStitcher)',
      },

      // From summaries_daily (may be incomplete)
      summaries: {
        total_hours: Math.round(summaryTotalHours * 100) / 100,
        heat_hours: Math.round(parseFloat(summaries.heat_hours) * 100) / 100,
        cool_hours: Math.round(parseFloat(summaries.cool_hours) * 100) / 100,
        fan_hours: Math.round(parseFloat(summaries.fan_hours) * 100) / 100,
        auxheat_hours: Math.round(parseFloat(summaries.auxheat_hours) * 100) / 100,
        unknown_hours: Math.round(parseFloat(summaries.unknown_hours) * 100) / 100,
        days_count: parseInt(summaries.days_count),
        first_date: summaries.first_date,
        last_date: summaries.last_date,
        source: 'summaries_daily (generated by summaryWorker)',
      },

      // Directly from runtime_sessions
      sessions: {
        total_hours: Math.round(sessionTotalHours * 100) / 100,
        heat_hours: Math.round(parseFloat(sessions.heat_hours) * 100) / 100,
        cool_hours: Math.round(parseFloat(sessions.cool_hours) * 100) / 100,
        fan_hours: Math.round(parseFloat(sessions.fan_hours) * 100) / 100,
        auxheat_hours: Math.round(parseFloat(sessions.auxheat_hours) * 100) / 100,
        unknown_hours: Math.round(parseFloat(sessions.unknown_hours) * 100) / 100,
        session_count: parseInt(sessions.session_count),
        first_session: sessions.first_session,
        last_session: sessions.last_session,
        source: 'runtime_sessions (raw session data)',
      },

      // Filter calculation verification
      filter_calculation: {
        calculated_filter_hours: Math.round(calculatedFilterHours * 100) / 100,
        stored_filter_hours: Math.round(realTimeFilterHours * 100) / 100,
        difference: Math.round((realTimeFilterHours - calculatedFilterHours) * 100) / 100,
        note: 'Calculated based on equipment_status and use_forced_air_for_heat setting',
      },

      // Today's activity
      today: {
        sessions_today: parseInt(today.session_count),
        hours_today: Math.round(todayHours * 100) / 100,
        last_summary_date: lastSummary.last_summary_date,
        note: todayHours > 0 && lastSummary.last_summary_date?.toISOString().split('T')[0] !== new Date().toISOString().split('T')[0]
          ? 'Today\'s runtime may not be in summaries_daily yet'
          : 'Summaries appear current',
      },

      // Missing days analysis
      missing_days: {
        count: missingDays.length,
        total_missing_hours: Math.round(missingDays.reduce((sum, d) => sum + (parseFloat(d.hours) || 0), 0) * 100) / 100,
        dates: missingDays.map(d => ({
          date: d.date?.toISOString().split('T')[0],
          hours: Math.round(parseFloat(d.hours) * 100) / 100,
        })),
        note: 'Days with runtime_sessions but no summaries_daily entry',
      },

      // Dates where summary hours < session hours (partial data loss)
      dates_with_lost_hours: {
        count: datesWithLostHours.length,
        total_lost_hours: Math.round(datesWithLostHours.reduce((sum, d) => sum + (parseFloat(d.hours_lost) || 0), 0) * 100) / 100,
        dates: datesWithLostHours.map(d => ({
          date: d.date?.toISOString().split('T')[0],
          session_hours: Math.round(parseFloat(d.session_hours) * 100) / 100,
          summary_hours: Math.round(parseFloat(d.summary_hours) * 100) / 100,
          hours_lost: Math.round(parseFloat(d.hours_lost) * 100) / 100,
          no_equipment_events: d.no_equipment_events,
        })),
        note: 'summaryWorker requires equipment_events to exist; dates without events lose runtime',
      },

      // Discrepancy analysis
      discrepancies: {
        filter_vs_summaries: Math.round((realTimeFilterHours - summaryTotalHours) * 100) / 100,
        filter_vs_sessions: Math.round((realTimeFilterHours - sessionTotalHours) * 100) / 100,
        summaries_vs_sessions: Math.round((summaryTotalHours - sessionTotalHours) * 100) / 100,
        possible_causes: [
          ...(datesWithLostHours.length > 0 ? [`${datesWithLostHours.length} dates have partial/missing runtime in summaries (${Math.round(datesWithLostHours.reduce((sum, d) => sum + (parseFloat(d.hours_lost) || 0), 0) * 100) / 100} hours lost)`] : []),
          ...(datesWithLostHours.some(d => d.no_equipment_events) ? ['Some dates have no equipment_events - summaryWorker skips these'] : []),
          ...(missingDays.length > 0 ? [`${missingDays.length} days completely missing from summaries (${Math.round(missingDays.reduce((sum, d) => sum + (parseFloat(d.hours) || 0), 0) * 100) / 100} hours)`] : []),
          ...(todayHours > 0 ? [`Today's ${todayHours.toFixed(2)} hours may not be in summaries yet`] : []),
          ...(Math.abs(realTimeFilterHours - calculatedFilterHours) > 0.1 ? ['Filter hours calculation drift detected'] : []),
          ...(parseInt(summaries.days_count) === 0 ? ['No summary data found for this device'] : []),
          ...(parseFloat(sessions.unknown_hours) > 1 ? [`${parseFloat(sessions.unknown_hours).toFixed(2)} hours in unknown mode`] : []),
        ],
      },
    });
  } catch (err: any) {
    console.error('[admin/runtime/reconcile] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
