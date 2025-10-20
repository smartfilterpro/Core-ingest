import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /runtime-sessions
 * Get runtime sessions for a device with optional date filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { device_key, start_date, end_date, limit = 100 } = req.query;
    
    if (!device_key) {
      return res.status(400).json({ ok: false, error: 'device_key is required' });
    }
    
    let query = `
      SELECT 
        session_id,
        device_key,
        mode,
        equipment_status,
        started_at,
        ended_at,
        duration_seconds,
        tick_count,
        terminated_reason
      FROM runtime_sessions
      WHERE device_key = $1
    `;
    const params: any[] = [device_key];
    
    if (start_date) {
      params.push(start_date);
      query += ` AND started_at >= $${params.length}`;
    }
    
    if (end_date) {
      params.push(end_date);
      query += ` AND started_at <= $${params.length}`;
    }
    
    query += ' ORDER BY started_at DESC';
    
    if (limit) {
      params.push(limit);
      query += ` LIMIT $${params.length}`;
    }
    
    const { rows } = await pool.query(query, params);
    
    res.json({
      ok: true,
      count: rows.length,
      sessions: rows,
    });
  } catch (err: any) {
    console.error('[runtime-sessions/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
