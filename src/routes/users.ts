import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

/**
 * DELETE /users/:userId
 * Deletes a user and all associated thermostats and data.
 * Finds all devices with matching user_id and deletes them along with all related data.
 */
router.delete('/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Missing userId' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // First, get all devices for this user
    const devicesResult = await client.query(
      'SELECT device_id, device_key, device_name FROM devices WHERE user_id = $1',
      [userId]
    );

    if (devicesResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'No devices found for this user' });
    }

    const devices = devicesResult.rows;
    const deviceIds = devices.map(d => d.device_id);
    const deviceKeys = devices.map(d => d.device_key);

    console.log(`[deleteUser] Found ${devices.length} devices for user ${userId}`);

    // Delete all related records for all devices belonging to this user
    // Order matters: delete dependent records before parent records

    // 1. Delete filter resets (references device_id)
    const filterResetsResult = await client.query(
      'DELETE FROM filter_resets WHERE device_id = ANY($1::int[])',
      [deviceIds]
    );

    // 2. Delete Ecobee runtime intervals (references device_key)
    const ecobeeResult = await client.query(
      'DELETE FROM ecobee_runtime_intervals WHERE device_key = ANY($1::varchar[])',
      [deviceKeys]
    );

    // 3. Delete equipment events (references device_key)
    const eventsResult = await client.query(
      'DELETE FROM equipment_events WHERE device_key = ANY($1::varchar[])',
      [deviceKeys]
    );

    // 4. Delete runtime sessions (references device_key)
    const sessionsResult = await client.query(
      'DELETE FROM runtime_sessions WHERE device_key = ANY($1::varchar[])',
      [deviceKeys]
    );

    // 5. Delete daily summaries (references device_id)
    const summariesResult = await client.query(
      'DELETE FROM summaries_daily WHERE device_id = ANY($1::int[])',
      [deviceIds]
    );

    // 6. Delete device status (references device_id)
    const statusResult = await client.query(
      'DELETE FROM device_status WHERE device_id = ANY($1::int[])',
      [deviceIds]
    );

    // 7. Delete device states (references device_key)
    const statesResult = await client.query(
      'DELETE FROM device_states WHERE device_key = ANY($1::varchar[])',
      [deviceKeys]
    );

    // 8. Finally, delete all devices for this user
    const deleteDevicesResult = await client.query(
      'DELETE FROM devices WHERE user_id = $1',
      [userId]
    );

    await client.query('COMMIT');

    console.log(`[deleteUser] Deleted user ${userId} with ${devices.length} devices and all linked data:`);
    console.log(`  - ${filterResetsResult.rowCount} filter resets`);
    console.log(`  - ${ecobeeResult.rowCount} ecobee runtime intervals`);
    console.log(`  - ${eventsResult.rowCount} equipment events`);
    console.log(`  - ${sessionsResult.rowCount} runtime sessions`);
    console.log(`  - ${summariesResult.rowCount} daily summaries`);
    console.log(`  - ${statusResult.rowCount} device statuses`);
    console.log(`  - ${statesResult.rowCount} device states`);
    console.log(`  - ${deleteDevicesResult.rowCount} devices`);

    return res.status(200).json({
      ok: true,
      message: `User ${userId} and all linked data deleted successfully.`,
      deletedDevices: devices.length,
      devices: devices.map(d => ({
        device_id: d.device_id,
        device_key: d.device_key,
        device_name: d.device_name
      }))
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[deleteUser] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;
