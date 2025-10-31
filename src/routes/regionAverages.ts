import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /region-averages
 * Get regional averages with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { region_prefix, days = 7 } = req.query;

    let query = `
      SELECT
        region_prefix,
        date,
        avg_runtime_seconds,
        avg_runtime_seconds / 3600.0 as avg_runtime_hours,
        avg_temp,
        avg_humidity,
        sample_size,
        updated_at
      FROM region_averages
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Filter by region_prefix if provided
    if (region_prefix) {
      query += ` AND region_prefix = $${paramIndex}`;
      params.push(region_prefix);
      paramIndex++;
    }

    // Filter by days lookback
    if (days !== 'all') {
      query += ` AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'`;
    }

    query += ` ORDER BY date DESC, region_prefix`;

    const { rows } = await pool.query(query, params);

    res.json({
      ok: true,
      count: rows.length,
      data: rows,
    });
  } catch (err: any) {
    console.error('[region-averages/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /region-averages/:regionPrefix
 * Get averages for a specific region
 */
router.get('/:regionPrefix', async (req: Request, res: Response) => {
  try {
    const { regionPrefix } = req.params;
    const { days = 30 } = req.query;

    const dateFilter = days === 'all'
      ? ''
      : `AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'`;

    const { rows } = await pool.query(
      `
      SELECT
        region_prefix,
        date,
        avg_runtime_seconds,
        avg_runtime_seconds / 3600.0 as avg_runtime_hours,
        avg_temp,
        avg_humidity,
        sample_size,
        updated_at
      FROM region_averages
      WHERE region_prefix = $1
        ${dateFilter}
      ORDER BY date DESC
      `,
      [regionPrefix]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No data found for this region' });
    }

    res.json({
      ok: true,
      region_prefix: regionPrefix,
      count: rows.length,
      data: rows,
    });
  } catch (err: any) {
    console.error('[region-averages/:regionPrefix/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /region-averages/:regionPrefix/summary
 * Get aggregated summary for a specific region
 */
router.get('/:regionPrefix/summary', async (req: Request, res: Response) => {
  try {
    const { regionPrefix } = req.params;
    const { days = 30 } = req.query;

    const dateFilter = days === 'all'
      ? ''
      : `AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'`;

    const { rows } = await pool.query(
      `
      SELECT
        region_prefix,
        COUNT(*) as days_tracked,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        AVG(avg_runtime_seconds) as overall_avg_runtime_seconds,
        AVG(avg_runtime_seconds) / 3600.0 as overall_avg_runtime_hours,
        AVG(avg_temp) as overall_avg_temp,
        AVG(avg_humidity) as overall_avg_humidity,
        AVG(sample_size) as avg_sample_size,
        SUM(sample_size) as total_device_days,
        MAX(updated_at) as last_updated
      FROM region_averages
      WHERE region_prefix = $1
        ${dateFilter}
      GROUP BY region_prefix
      `,
      [regionPrefix]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No data found for this region' });
    }

    res.json({
      ok: true,
      summary: rows[0],
    });
  } catch (err: any) {
    console.error('[region-averages/:regionPrefix/summary/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
