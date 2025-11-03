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

/**
 * PATCH /devices/:device_id
 * Update device configuration from Bubble
 *
 * Accepts device_id (can be device_key or device_id field)
 * Updates: zip_prefix, filter_target_hours, use_forced_air_for_heat, zip_code_prefix, timezone, user_id
 */
router.patch('/:device_id', async (req: Request, res: Response) => {
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

export default router;
