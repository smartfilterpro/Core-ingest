// routes/predictions.ts
import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /predictions/:device_id/latest
 * Get the most recent AI prediction for a device's filter delivery
 *
 * Returns the latest prediction from the ai_predictions table (populated by AI service)
 * Does NOT proxy to AI service - queries database directly
 */
router.get('/:device_id/latest', async (req: Request, res: Response) => {
  try {
    const { device_id } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        device_id,
        predicted_days_remaining,
        predicted_hours_remaining,
        predicted_usage_percent,
        anomaly_score,
        avg_daily_runtime_hours,
        region_avg_runtime_hours,
        recent_runtime_hours,
        runtime_trend_factor,
        filter_age_days,
        total_runtime_hours,
        created_at
      FROM ai_predictions
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [device_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No prediction found for this device'
      });
    }

    res.json({
      ok: true,
      prediction: rows[0],
    });
  } catch (err: any) {
    console.error('[predictions/:device_id/latest/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
