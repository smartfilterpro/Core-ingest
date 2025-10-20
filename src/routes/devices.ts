// routes/devices.ts - NEW FILE
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

// ============================================
// routes/runtimeSessions.ts - NEW FILE
// ============================================
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

// ============================================
// routes/summaries.ts - NEW FILE
// ============================================
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
    
    const { rows } = await pool.query(
      `
      SELECT 
        device_id,
        date,
        runtime_seconds_total,
        runtime_sessions_count,
        avg_temperature,
        updated_at
      FROM summaries_daily
      WHERE device_id = $1
        AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'
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

export default router;

// ============================================
// routes/equipmentEvents.ts - NEW FILE
// ============================================
import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /equipment-events
 * Get equipment events for a device
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { device_key, limit = 100, offset = 0 } = req.query;
    
    if (!device_key) {
      return res.status(400).json({ ok: false, error: 'device_key is required' });
    }
    
    const { rows } = await pool.query(
      `
      SELECT 
        id,
        device_key,
        event_type,
        equipment_status,
        is_active,
        last_temperature,
        last_humidity,
        runtime_seconds,
        recorded_at,
        event_timestamp
      FROM equipment_events
      WHERE device_key = $1
      ORDER BY recorded_at DESC
      LIMIT $2 OFFSET $3
      `,
      [device_key, limit, offset]
    );
    
    res.json({
      ok: true,
      count: rows.length,
      events: rows,
    });
  } catch (err: any) {
    console.error('[equipment-events/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

// ============================================
// UPDATE server.ts to register new routes
// ============================================
// Add these imports at the top of server.ts:
import devicesRouter from './routes/devices';
import runtimeSessionsRouter from './routes/runtimeSessions';
import summariesRouter from './routes/summaries';
import equipmentEventsRouter from './routes/equipmentEvents';

// Add these route registrations after your existing routes:
app.use('/devices', devicesRouter);
app.use('/runtime-sessions', runtimeSessionsRouter);
app.use('/summaries', summariesRouter);
app.use('/equipment-events', equipmentEventsRouter);
