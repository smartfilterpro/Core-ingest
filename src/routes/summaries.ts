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
    // Use the device's timezone to determine "today" for proper date boundaries
    // The summaries_daily.date column stores dates in device local time
    const dateFilter = days === 'all'
      ? ''
      : `AND s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${parseInt(days as string)} days'`;

    const { rows } = await pool.query(
      `
      SELECT
        s.device_id,
        s.date,
        s.runtime_seconds_total,
        -- HVAC Mode Breakdown (what equipment is DOING)
        s.runtime_seconds_heat,
        s.runtime_seconds_cool,
        s.runtime_seconds_fan,
        s.runtime_seconds_auxheat,
        s.runtime_seconds_unknown,
        -- Operating Mode Distribution (what users SET thermostat to)
        s.runtime_seconds_mode_heat,
        s.runtime_seconds_mode_cool,
        s.runtime_seconds_mode_auto,
        s.runtime_seconds_mode_off,
        s.runtime_seconds_mode_away,
        s.runtime_seconds_mode_eco,
        s.runtime_seconds_mode_other,
        s.runtime_sessions_count,
        s.avg_temperature,
        s.avg_humidity,
        s.updated_at
      FROM summaries_daily s
      JOIN devices d ON d.device_id = s.device_id
      WHERE s.device_id = $1
        ${dateFilter}
      ORDER BY s.date DESC
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
 * Returns BOTH summaries_daily (historical) AND device_states (real-time) data
 */
router.get('/device/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Get summaries_daily aggregation (historical, may be incomplete)
    const summaryResult = await pool.query(
      `
      SELECT
        device_id,
        SUM(runtime_seconds_total) as total_runtime_seconds,
        SUM(runtime_sessions_count) as total_sessions,
        AVG(avg_temperature) as avg_temperature,
        AVG(avg_humidity) as avg_humidity,
        COUNT(*) as days_recorded,
        MIN(date) as earliest_date,
        MAX(date) as latest_date
      FROM summaries_daily
      WHERE device_id = $1
      GROUP BY device_id
      `,
      [deviceId]
    );

    // Get device_states (real-time, authoritative)
    const deviceStateResult = await pool.query(
      `
      SELECT
        d.device_id,
        d.device_key,
        d.device_name,
        d.filter_target_hours,
        d.filter_usage_percent,
        d.use_forced_air_for_heat,
        ds.hours_used_total,
        ds.filter_hours_used,
        ds.last_reset_ts,
        ds.last_event_ts,
        ds.is_active,
        EXTRACT(EPOCH FROM (NOW() - ds.last_reset_ts))/86400 as days_since_reset,
        CASE
          WHEN ds.filter_hours_used > 0 AND d.filter_target_hours > 0
          THEN d.filter_target_hours - COALESCE(ds.filter_hours_used, 0)
          ELSE d.filter_target_hours
        END as hours_remaining
      FROM devices d
      LEFT JOIN device_states ds ON ds.device_key = d.device_key
      WHERE d.device_id = $1
      `,
      [deviceId]
    );

    if (deviceStateResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    const deviceData = deviceStateResult.rows[0];
    const summaryData = summaryResult.rows[0] || {
      device_id: deviceId,
      total_runtime_seconds: 0,
      total_sessions: 0,
      avg_temperature: null,
      avg_humidity: null,
      days_recorded: 0,
      earliest_date: null,
      latest_date: null,
    };

    res.json({
      ok: true,
      device_id: deviceId,
      device_key: deviceData.device_key,
      device_name: deviceData.device_name,

      // RECOMMENDED: Use this for frontend display (real-time, complete)
      real_time: {
        total_runtime_hours: parseFloat(deviceData.hours_used_total) || 0,
        filter_runtime_hours: parseFloat(deviceData.filter_hours_used) || 0,
        filter_usage_percent: parseFloat(deviceData.filter_usage_percent) || 0,
        filter_target_hours: parseFloat(deviceData.filter_target_hours) || 100,
        hours_remaining: parseFloat(deviceData.hours_remaining) || 0,
        days_since_reset: deviceData.days_since_reset ? Math.floor(parseFloat(deviceData.days_since_reset)) : null,
        last_event_ts: deviceData.last_event_ts,
        is_active: deviceData.is_active,
        use_forced_air_for_heat: deviceData.use_forced_air_for_heat,
      },

      // Historical aggregation from summaries_daily (may be incomplete if not all dates processed)
      summaries: {
        total_runtime_hours: summaryData.total_runtime_seconds ? parseFloat(summaryData.total_runtime_seconds) / 3600 : 0,
        total_sessions: parseInt(summaryData.total_sessions) || 0,
        avg_temperature: summaryData.avg_temperature ? parseFloat(summaryData.avg_temperature) : null,
        avg_humidity: summaryData.avg_humidity ? parseFloat(summaryData.avg_humidity) : null,
        days_recorded: parseInt(summaryData.days_recorded) || 0,
        earliest_date: summaryData.earliest_date,
        latest_date: summaryData.latest_date,
      },

      // Legacy format for backward compatibility (use summaries_daily)
      summary: summaryData,
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

/**
 * GET /summaries/validate
 * Validate summary data completeness and identify date gaps
 * Uses device timezone for proper date comparisons
 */
router.get('/validate', async (req: Request, res: Response) => {
  try {
    const { device_id, days = 30 } = req.query;
    const daysNum = parseInt(days as string);

    // Query 1: Get all dates that SHOULD have summaries (based on runtime_sessions)
    // Use device timezone to convert started_at to local date (consistent with summary worker)
    const sourceDatesQuery = device_id
      ? `
        SELECT DISTINCT
          DATE(rs.started_at AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
          rs.device_key
        FROM runtime_sessions rs
        JOIN devices d ON d.device_key = rs.device_key
        WHERE rs.device_key = (SELECT device_key FROM devices WHERE device_id = $1)
          AND rs.started_at >= CURRENT_TIMESTAMP - INTERVAL '${daysNum} days'
        ORDER BY date DESC
      `
      : `
        SELECT DISTINCT
          DATE(rs.started_at AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
          rs.device_key
        FROM runtime_sessions rs
        JOIN devices d ON d.device_key = rs.device_key
        WHERE rs.started_at >= CURRENT_TIMESTAMP - INTERVAL '${daysNum} days'
        ORDER BY date DESC
      `;

    // Query 2: Get all dates that HAVE summaries
    // Use device timezone for date filtering
    const summaryDatesQuery = device_id
      ? `
        SELECT s.date, s.device_id
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.device_id = $1
          AND s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        ORDER BY s.date DESC
      `
      : `
        SELECT s.date, s.device_id
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        ORDER BY s.date DESC
      `;

    // Query 3: Find date gaps (dates with source data but no summary)
    // Use device timezone for consistent date comparisons
    const gapsQuery = device_id
      ? `
        WITH source_dates AS (
          SELECT DISTINCT
            DATE(rs.started_at AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
            rs.device_key,
            d.timezone
          FROM runtime_sessions rs
          JOIN devices d ON d.device_key = rs.device_key
          WHERE rs.device_key = (SELECT device_key FROM devices WHERE device_id = $1)
            AND rs.started_at >= CURRENT_TIMESTAMP - INTERVAL '${daysNum} days'
        ),
        summary_dates AS (
          SELECT s.date, s.device_id
          FROM summaries_daily s
          JOIN devices d ON d.device_id = s.device_id
          WHERE s.device_id = $1
            AND s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        )
        SELECT
          sd.date,
          sd.device_key,
          d.device_id,
          d.device_name,
          COUNT(*) as source_sessions
        FROM source_dates sd
        LEFT JOIN summary_dates sum ON sum.date = sd.date
        LEFT JOIN devices d ON d.device_key = sd.device_key
        WHERE sum.date IS NULL
        GROUP BY sd.date, sd.device_key, d.device_id, d.device_name
        ORDER BY sd.date DESC
      `
      : `
        WITH source_dates AS (
          SELECT DISTINCT
            DATE(rs.started_at AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
            rs.device_key,
            d.timezone
          FROM runtime_sessions rs
          JOIN devices d ON d.device_key = rs.device_key
          WHERE rs.started_at >= CURRENT_TIMESTAMP - INTERVAL '${daysNum} days'
        ),
        summary_dates AS (
          SELECT s.date, s.device_id
          FROM summaries_daily s
          JOIN devices d ON d.device_id = s.device_id
          WHERE s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        )
        SELECT
          sd.date,
          sd.device_key,
          d.device_id,
          d.device_name,
          COUNT(*) as missing_count
        FROM source_dates sd
        LEFT JOIN summary_dates sum ON sum.date = sd.date AND sum.device_id = d.device_id
        LEFT JOIN devices d ON d.device_key = sd.device_key
        WHERE sum.date IS NULL
        GROUP BY sd.date, sd.device_key, d.device_id, d.device_name
        ORDER BY sd.date DESC
        LIMIT 100
      `;

    // Query 4: Get summary statistics
    // Use device timezone for date filtering
    const statsQuery = device_id
      ? `
        SELECT
          COUNT(DISTINCT s.date) as total_summary_days,
          MIN(s.date) as earliest_summary,
          MAX(s.date) as latest_summary,
          MAX(s.updated_at) as last_updated
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.device_id = $1
          AND s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
      `
      : `
        SELECT
          COUNT(*) as total_summaries,
          COUNT(DISTINCT s.date) as total_summary_days,
          COUNT(DISTINCT s.device_id) as devices_with_summaries,
          MIN(s.date) as earliest_summary,
          MAX(s.date) as latest_summary,
          MAX(s.updated_at) as last_updated
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
      `;

    const params = device_id ? [device_id] : [];

    const [sourceDates, summaryDates, gaps, stats] = await Promise.all([
      pool.query(sourceDatesQuery, params),
      pool.query(summaryDatesQuery, params),
      pool.query(gapsQuery, params),
      pool.query(statsQuery, params),
    ]);

    // Calculate expected date range
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysNum);

    // Generate list of all dates in range for comparison
    const allDates = [];
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      allDates.push(new Date(d).toISOString().split('T')[0]);
    }

    // Find completely missing dates (no source data at all)
    const sourceDateSet = new Set(sourceDates.rows.map(r => r.date?.toISOString().split('T')[0]));
    const summaryDateSet = new Set(summaryDates.rows.map(r => r.date?.toISOString().split('T')[0]));

    const missingSourceDates = allDates.filter(d => !sourceDateSet.has(d));
    const missingSummaryDates = allDates.filter(d => !summaryDateSet.has(d));

    res.json({
      ok: true,
      validation: {
        period: {
          days: daysNum,
          start_date: allDates[0],
          end_date: allDates[allDates.length - 1],
          total_expected_dates: allDates.length,
        },
        statistics: stats.rows[0],
        health: {
          source_data_dates: sourceDates.rows.length,
          summary_dates: summaryDates.rows.length,
          date_gaps_count: gaps.rows.length,
          coverage_percent: sourceDates.rows.length > 0
            ? Math.round((summaryDates.rows.length / sourceDates.rows.length) * 100)
            : 0,
        },
        date_gaps: gaps.rows.map(row => ({
          date: row.date,
          device_id: row.device_id,
          device_name: row.device_name,
          device_key: row.device_key,
        })),
        missing_source_dates: missingSourceDates.slice(0, 20), // Limit to first 20
        missing_summary_dates: missingSummaryDates.slice(0, 20), // Limit to first 20
      },
    });
  } catch (err: any) {
    console.error('[summaries/validate/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /summaries/dates-present
 * Get a simple list of dates that have summary data (useful for debugging)
 * Uses device timezone for proper date filtering
 */
router.get('/dates-present', async (req: Request, res: Response) => {
  try {
    const { device_id, days = 30 } = req.query;
    const daysNum = parseInt(days as string);

    // Use device timezone for date filtering
    // The summaries_daily.date column stores dates in device local time
    const query = device_id
      ? `
        SELECT DISTINCT s.date
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.device_id = $1
          AND s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        ORDER BY s.date DESC
      `
      : `
        SELECT DISTINCT s.date, COUNT(*) as device_count
        FROM summaries_daily s
        JOIN devices d ON d.device_id = s.device_id
        WHERE s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${daysNum} days'
        GROUP BY s.date
        ORDER BY s.date DESC
      `;

    const params = device_id ? [device_id] : [];
    const { rows } = await pool.query(query, params);

    res.json({
      ok: true,
      count: rows.length,
      dates: rows.map(r => ({
        date: r.date,
        ...(r.device_count && { device_count: parseInt(r.device_count) })
      })),
    });
  } catch (err: any) {
    console.error('[summaries/dates-present/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
