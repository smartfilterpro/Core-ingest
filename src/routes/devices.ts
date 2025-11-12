// routes/devices.ts
import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

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

/**
 * PATCH /devices/:device_id
 * Update device configuration from Bubble
 *
 * Accepts device_id (can be device_key or device_id field)
 * Updates: zip_prefix, filter_target_hours, use_forced_air_for_heat, zip_code_prefix, timezone, user_id
 */
router.patch('/:device_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { device_id } = req.params;
    const {
      zip_prefix,
      filter_target_hours,
      use_forced_air_for_heat,
      zip_code_prefix,
      timezone,
      user_id,
    } = req.body;

    // Validate at least one field is provided
    if (
      zip_prefix === undefined &&
      filter_target_hours === undefined &&
      use_forced_air_for_heat === undefined &&
      zip_code_prefix === undefined &&
      timezone === undefined &&
      user_id === undefined
    ) {
      return res.status(400).json({
        ok: false,
        error: 'At least one field must be provided: zip_prefix, filter_target_hours, use_forced_air_for_heat, zip_code_prefix, timezone, user_id'
      });
    }

    // Build dynamic UPDATE query for only provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (zip_prefix !== undefined) {
      updates.push(`zip_prefix = $${paramIndex++}`);
      values.push(zip_prefix);
    }

    if (filter_target_hours !== undefined) {
      updates.push(`filter_target_hours = $${paramIndex++}`);
      values.push(filter_target_hours);
    }

    if (use_forced_air_for_heat !== undefined) {
      updates.push(`use_forced_air_for_heat = $${paramIndex++}`);
      values.push(use_forced_air_for_heat);
    }

    if (zip_code_prefix !== undefined) {
      updates.push(`zip_code_prefix = $${paramIndex++}`);
      values.push(zip_code_prefix);
    }

    if (timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      values.push(timezone);
    }

    if (user_id !== undefined) {
      updates.push(`user_id = $${paramIndex++}`);
      values.push(user_id);
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    // Add device_id as last parameter
    values.push(device_id);

    const query = `
      UPDATE devices
      SET ${updates.join(', ')}
      WHERE device_key = $${paramIndex} OR device_id = $${paramIndex}
      RETURNING
        device_id,
        device_key,
        device_name,
        zip_prefix,
        zip_code_prefix,
        filter_target_hours,
        use_forced_air_for_heat,
        timezone,
        user_id,
        updated_at
    `;

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Device not found'
      });
    }

    console.log(`[devices/PATCH] Updated device ${device_id}:`, req.body);

    res.json({
      ok: true,
      device: rows[0],
      updated_fields: Object.keys(req.body),
    });
  } catch (err: any) {
    console.error('[devices/PATCH] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /devices/:deviceId
 * Deletes a specific device and all associated data (runtime sessions, filtered data, etc.)
 * Uses a transaction to ensure all related records are deleted in the correct order
 */
router.delete('/:deviceId', requireAuth, async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'Missing deviceId' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // First, get the device to verify it exists and get device_key
    const deviceResult = await client.query(
      'SELECT device_id, device_key, device_name FROM devices WHERE device_id = $1 OR device_key = $1',
      [deviceId]
    );

    if (deviceResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    const device = deviceResult.rows[0];
    const { device_id, device_key, device_name } = device;

    // Delete all related records in correct order to avoid foreign key constraint violations
    // Order matters: delete dependent records before parent records

    // 1. Delete filter resets (try device_id first, fallback to device_key)
    try {
      await client.query('DELETE FROM filter_resets WHERE device_id = $1', [device_id]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] filter_resets table does not exist, skipping');
      } else if (err.code === '42703') {
        // device_id column doesn't exist - try device_key instead
        console.log('[deleteDevice] filter_resets.device_id does not exist, trying device_key');
        try {
          await client.query('DELETE FROM filter_resets WHERE device_key = $1', [device_key]);
        } catch (err2: any) {
          if (err2.code === '42703') {
            console.log('[deleteDevice] filter_resets.device_key also does not exist, skipping');
          } else {
            console.warn('[deleteDevice] Error deleting filter_resets with device_key (continuing anyway):', err2.message);
          }
        }
      } else {
        console.warn('[deleteDevice] Error deleting filter_resets (continuing anyway):', err.message);
      }
    }

    // 2. Delete Ecobee runtime intervals (references device_key)
    try {
      await client.query('DELETE FROM ecobee_runtime_intervals WHERE device_key = $1', [device_key]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] ecobee_runtime_intervals table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting ecobee_runtime_intervals (continuing anyway):', err.message);
      }
    }

    // 3. Delete equipment events (references device_key)
    try {
      await client.query('DELETE FROM equipment_events WHERE device_key = $1', [device_key]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] equipment_events table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting equipment_events (continuing anyway):', err.message);
      }
    }

    // 4. Delete runtime sessions (references device_key)
    try {
      await client.query('DELETE FROM runtime_sessions WHERE device_key = $1', [device_key]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] runtime_sessions table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting runtime_sessions (continuing anyway):', err.message);
      }
    }

    // 5. Delete daily summaries (references device_id)
    try {
      await client.query('DELETE FROM summaries_daily WHERE device_id = $1', [device_id]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] summaries_daily table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting summaries_daily (continuing anyway):', err.message);
      }
    }

    // 6. Delete device status (try device_id first, fallback to device_key)
    try {
      await client.query('DELETE FROM device_status WHERE device_id = $1', [device_id]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] device_status table does not exist, skipping');
      } else if (err.code === '42703') {
        // device_id column doesn't exist - try device_key instead
        console.log('[deleteDevice] device_status.device_id does not exist, trying device_key');
        try {
          await client.query('DELETE FROM device_status WHERE device_key = $1', [device_key]);
        } catch (err2: any) {
          if (err2.code === '42703') {
            console.log('[deleteDevice] device_status.device_key also does not exist, skipping');
          } else {
            console.warn('[deleteDevice] Error deleting device_status with device_key (continuing anyway):', err2.message);
          }
        }
      } else {
        console.warn('[deleteDevice] Error deleting device_status (continuing anyway):', err.message);
      }
    }

    // 7. Delete device states (references device_key)
    try {
      await client.query('DELETE FROM device_states WHERE device_key = $1', [device_key]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] device_states table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting device_states (continuing anyway):', err.message);
      }
    }

    // 8. Finally, delete the device itself
    try {
      await client.query('DELETE FROM devices WHERE device_id = $1', [device_id]);
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteDevice] devices table does not exist, skipping');
      } else {
        console.warn('[deleteDevice] Error deleting devices (continuing anyway):', err.message);
      }
    }

    await client.query('COMMIT');

    console.log(`[deleteDevice] Deleted device ${device_id} (${device_key}) and all linked data.`);

    return res.status(200).json({
      ok: true,
      message: `Device ${device_name || device_key} deleted successfully.`,
      device: {
        device_id,
        device_key,
        device_name
      }
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[deleteDevice] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;
