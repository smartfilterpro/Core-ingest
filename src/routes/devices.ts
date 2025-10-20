// routes/devices.ts
import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /devices
 * Get all devices for a user (optionally filtered by user_id)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id, workspace_id } = req.query;
    
    let query = 'SELECT * FROM devices WHERE 1=1';
    const params: any[] = [];
    
    if (user_id) {
      params.push(user_id);
      query += ` AND user_id = $${params.length}`;
    }
    
    if (workspace_id) {
      params.push(workspace_id);
      query += ` AND workspace_id = $${params.length}`;
    }
    
    query += ' ORDER BY updated_at DESC';
    
    const { rows } = await pool.query(query, params);
    
    res.json({
      ok: true,
      count: rows.length,
      devices: rows,
    });
  } catch (err: any) {
    console.error('[devices/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /devices/:deviceKey
 * Get a specific device by device_key
 */
router.get('/:deviceKey', async (req: Request, res: Response) => {
  try {
    const { deviceKey } = req.params;
    
    const { rows } = await pool.query(
      'SELECT * FROM devices WHERE device_key = $1',
      [deviceKey]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }
    
    res.json({
      ok: true,
      device: rows[0],
    });
  } catch (err: any) {
    console.error('[devices/GET/:id] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
