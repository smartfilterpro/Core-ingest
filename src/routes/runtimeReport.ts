import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * POST /ingest/v1/runtime-report
 * Ingest Ecobee Runtime Report intervals
 *
 * Body: {
 *   device_key: string,
 *   report_date: string (YYYY-MM-DD),
 *   intervals: Array<{
 *     interval_timestamp: string (ISO 8601),
 *     aux_heat1_seconds: number (0-300),
 *     aux_heat2_seconds?: number,
 *     aux_heat3_seconds?: number,
 *     comp_cool1_seconds: number (0-300),
 *     comp_cool2_seconds?: number,
 *     comp_heat1_seconds: number (0-300),
 *     comp_heat2_seconds?: number,
 *     fan_seconds: number (0-300),
 *     outdoor_temp_f?: number,
 *     zone_avg_temp_f?: number,
 *     zone_humidity?: number,
 *     hvac_mode?: string
 *   }>
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  const { device_key, report_date, intervals } = req.body;

  // Input validation
  if (!device_key || typeof device_key !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'device_key is required and must be a string'
    });
  }

  if (!report_date || !/^\d{4}-\d{2}-\d{2}$/.test(report_date)) {
    return res.status(400).json({
      ok: false,
      error: 'report_date is required and must be YYYY-MM-DD format'
    });
  }

  if (!Array.isArray(intervals) || intervals.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'intervals must be a non-empty array'
    });
  }

  console.log(
    `[runtime-report] Ingesting ${intervals.length} intervals ` +
    `for ${device_key} on ${report_date}`
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let stored = 0;
    for (const interval of intervals) {
      // Validate interval has timestamp
      if (!interval.interval_timestamp) {
        console.warn(`[runtime-report] Skipping interval with missing timestamp`);
        continue;
      }

      await client.query(
        `INSERT INTO ecobee_runtime_intervals (
          device_key, report_date, interval_timestamp,
          aux_heat1_seconds, aux_heat2_seconds, aux_heat3_seconds,
          comp_cool1_seconds, comp_cool2_seconds,
          comp_heat1_seconds, comp_heat2_seconds,
          fan_seconds,
          outdoor_temp_f, zone_avg_temp_f, zone_humidity, hvac_mode
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (device_key, interval_timestamp)
        DO UPDATE SET
          aux_heat1_seconds = EXCLUDED.aux_heat1_seconds,
          aux_heat2_seconds = EXCLUDED.aux_heat2_seconds,
          aux_heat3_seconds = EXCLUDED.aux_heat3_seconds,
          comp_cool1_seconds = EXCLUDED.comp_cool1_seconds,
          comp_cool2_seconds = EXCLUDED.comp_cool2_seconds,
          comp_heat1_seconds = EXCLUDED.comp_heat1_seconds,
          comp_heat2_seconds = EXCLUDED.comp_heat2_seconds,
          fan_seconds = EXCLUDED.fan_seconds,
          outdoor_temp_f = EXCLUDED.outdoor_temp_f,
          zone_avg_temp_f = EXCLUDED.zone_avg_temp_f,
          zone_humidity = EXCLUDED.zone_humidity,
          hvac_mode = EXCLUDED.hvac_mode`,
        [
          device_key,
          report_date,
          interval.interval_timestamp,
          interval.aux_heat1_seconds || 0,
          interval.aux_heat2_seconds || 0,
          interval.aux_heat3_seconds || 0,
          interval.comp_cool1_seconds || 0,
          interval.comp_cool2_seconds || 0,
          interval.comp_heat1_seconds || 0,
          interval.comp_heat2_seconds || 0,
          interval.fan_seconds || 0,
          interval.outdoor_temp_f || null,
          interval.zone_avg_temp_f || null,
          interval.zone_humidity || null,
          interval.hvac_mode || null
        ]
      );
      stored++;
    }

    // Calculate daily summary totals from all intervals
    const { rows } = await client.query(
      `SELECT
        COALESCE(SUM(aux_heat1_seconds + aux_heat2_seconds + aux_heat3_seconds), 0) as total_auxheat,
        COALESCE(SUM(comp_cool1_seconds + comp_cool2_seconds), 0) as total_cooling,
        COALESCE(SUM(comp_heat1_seconds + comp_heat2_seconds), 0) as total_heating,
        COALESCE(SUM(fan_seconds), 0) as total_fan,
        COUNT(*) as interval_count
      FROM ecobee_runtime_intervals
      WHERE device_key = $1 AND report_date = $2`,
      [device_key, report_date]
    );

    const summary = rows[0];
    const total_runtime =
      parseInt(summary.total_heating) +
      parseInt(summary.total_cooling) +
      parseInt(summary.total_auxheat);
    const coverage_percent = (parseInt(summary.interval_count) / 288) * 100;

    await client.query('COMMIT');

    console.log(
      `[runtime-report] ✅ Stored ${stored} intervals for ${device_key}`
    );
    console.log(
      `[runtime-report] Summary: ${total_runtime}s total, ` +
      `${coverage_percent.toFixed(1)}% coverage`
    );

    res.json({
      ok: true,
      stored,
      summary: {
        total_runtime_seconds: total_runtime,
        heating_seconds: parseInt(summary.total_heating),
        cooling_seconds: parseInt(summary.total_cooling),
        auxheat_seconds: parseInt(summary.total_auxheat),
        fan_seconds: parseInt(summary.total_fan),
        coverage_percent: Math.round(coverage_percent * 100) / 100,
        interval_count: parseInt(summary.interval_count)
      }
    });

  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[runtime-report/POST] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;
