import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
const router = express.Router();

/**
 * GET /summaries/daily
 * Get daily summaries for a device
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { device_id, days = 30 } = req.query;

    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'device_id is required' });
    }

    // Build date filter - support 'all' for lifetime data
    const dateFilter = days === 'all'
      ? ''
      : `AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'`;

    const { rows } = await pool.query(
      `
      SELECT
        device_id,
        date,
        runtime_seconds_total,
        -- HVAC Mode Breakdown (what equipment is DOING)
        runtime_seconds_heat,
        runtime_seconds_cool,
        runtime_seconds_fan,
        runtime_seconds_auxheat,
        runtime_seconds_unknown,
        -- Operating Mode Distribution (what users SET thermostat to)
        runtime_seconds_mode_heat,
        runtime_seconds_mode_cool,
        runtime_seconds_mode_auto,
        runtime_seconds_mode_off,
        runtime_seconds_mode_away,
        runtime_seconds_mode_eco,
        runtime_seconds_mode_other,
        runtime_sessions_count,
        avg_temperature,
        avg_humidity,
        updated_at
      FROM summaries_daily
      WHERE device_id = $1
        ${dateFilter}
      ORDER BY date DESC
      `,
      [device_id]
    );
    
    res.json({
      ok: true,
      count: rows.length,
      summaries: rows,
    });
  } catch (err: any) {
    console.error('[summaries/daily/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /summaries/device/:deviceId
 * Get aggregated summary for a device
 */
router.get('/device/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    
    const { rows } = await pool.query(
      `
      SELECT 
        device_id,
        SUM(runtime_seconds_total) as total_runtime_seconds,
        SUM(runtime_sessions_count) as total_sessions,
        AVG(avg_temperature) as avg_temperature,
        AVG(avg_humidity) as avg_humidity,
        COUNT(*) as days_recorded
      FROM summaries_daily
      WHERE device_id = $1
      GROUP BY device_id
      `,
      [deviceId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No summary data found' });
    }
    
    res.json({
      ok: true,
      summary: rows[0],
    });
  } catch (err: any) {
    console.error('[summaries/device/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /summaries/filter-status/:deviceKey
 * Get comprehensive filter lifecycle status for a device
 */
router.get('/filter-status/:deviceKey', async (req: Request, res: Response) => {
  try {
    const { deviceKey } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        d.device_key,
        d.device_id,
        d.device_name,
        d.filter_target_hours,
        d.filter_usage_percent,
        d.use_forced_air_for_heat,
        ds.hours_used_total,
        COALESCE(ds.filter_hours_used, 0) as filter_hours_used,
        ds.last_reset_ts,
        EXTRACT(EPOCH FROM (NOW() - ds.last_reset_ts))/86400 as days_since_reset,
        CASE
          WHEN ds.filter_hours_used > 0 AND d.filter_target_hours > 0
          THEN d.filter_target_hours - COALESCE(ds.filter_hours_used, 0)
          ELSE d.filter_target_hours
        END as hours_remaining,
        fr.last_reset_user,
        fr.last_reset_source
      FROM devices d
      LEFT JOIN device_states ds ON ds.device_key = d.device_key
      LEFT JOIN LATERAL (
        SELECT user_id as last_reset_user, source as last_reset_source
        FROM filter_resets
        WHERE device_id = d.device_id
        ORDER BY triggered_at DESC
        LIMIT 1
      ) fr ON true
      WHERE d.device_key = $1
      `,
      [deviceKey]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    const data = rows[0];

    // Calculate estimated days remaining based on average daily usage
    let estimated_days_remaining = null;
    if (data.days_since_reset > 0 && data.filter_hours_used > 0) {
      const avg_hours_per_day = data.filter_hours_used / data.days_since_reset;
      if (avg_hours_per_day > 0 && data.hours_remaining > 0) {
        estimated_days_remaining = Math.round(data.hours_remaining / avg_hours_per_day);
      }
    }

    res.json({
      ok: true,
      filter_status: {
        device_key: data.device_key,
        device_id: data.device_id,
        device_name: data.device_name,
        filter_target_hours: parseFloat(data.filter_target_hours) || 100,
        filter_usage_percent: parseFloat(data.filter_usage_percent) || 0,
        hours_used_total: parseFloat(data.hours_used_total) || 0,
        filter_hours_used: parseFloat(data.filter_hours_used) || 0,
        hours_remaining: Math.max(0, parseFloat(data.hours_remaining) || 0),
        last_reset_date: data.last_reset_ts,
        days_since_reset: data.days_since_reset ? Math.floor(parseFloat(data.days_since_reset)) : null,
        estimated_days_remaining,
        use_forced_air_for_heat: data.use_forced_air_for_heat,
        last_reset_user: data.last_reset_user,
        last_reset_source: data.last_reset_source,
      },
    });
  } catch (err: any) {
    console.error('[summaries/filter-status/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
