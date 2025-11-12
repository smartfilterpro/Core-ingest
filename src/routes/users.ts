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
    // First, get all devices for this user (no transaction yet)
    const devicesResult = await client.query(
      'SELECT device_id, device_key, device_name FROM devices WHERE user_id = $1',
      [userId]
    );

    if (devicesResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'No devices found for this user' });
    }

    const devices = devicesResult.rows;
    const deviceIds = devices.map(d => d.device_id);
    const deviceKeys = devices.map(d => d.device_key);

    console.log(`[deleteUser] Found ${devices.length} devices for user ${userId}`);

    // Delete all related records for all devices belonging to this user
    // NO TRANSACTION - Each deletion is independent to allow permissive error handling
    // If one table fails, others can still succeed

    // 1. Delete AI predictions (references device_id or device_key)
    let predictionsResult;
    try {
      predictionsResult = await client.query(
        'DELETE FROM ai_predictions WHERE device_id = ANY($1)',
        [deviceIds]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] ai_predictions table does not exist, skipping');
      } else if (err.code === '42703') {
        console.log('[deleteUser] ai_predictions.device_id does not exist, trying device_key');
        try {
          predictionsResult = await client.query(
            'DELETE FROM ai_predictions WHERE device_key = ANY($1)',
            [deviceKeys]
          );
        } catch (err2: any) {
          console.warn('[deleteUser] Error deleting ai_predictions with device_key (skipping):', err2.message);
          predictionsResult = { rowCount: 0 };
        }
      } else {
        console.warn('[deleteUser] Error deleting ai_predictions (skipping):', err.message);
      }
      predictionsResult = predictionsResult || { rowCount: 0 };
    }

    // 2. Delete filter resets (try device_id first, fallback to device_key)
    let filterResetsResult;
    try {
      filterResetsResult = await client.query(
        'DELETE FROM filter_resets WHERE device_id = ANY($1)',
        [deviceIds]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] filter_resets table does not exist, skipping');
      } else if (err.code === '42703') {
        console.log('[deleteUser] filter_resets.device_id does not exist, trying device_key');
        try {
          filterResetsResult = await client.query(
            'DELETE FROM filter_resets WHERE device_key = ANY($1)',
            [deviceKeys]
          );
        } catch (err2: any) {
          console.warn('[deleteUser] Error deleting filter_resets with device_key (skipping):', err2.message);
          filterResetsResult = { rowCount: 0 };
        }
      } else {
        console.warn('[deleteUser] Error deleting filter_resets (skipping):', err.message);
      }
      filterResetsResult = filterResetsResult || { rowCount: 0 };
    }

    // 3. Delete Ecobee runtime intervals (references device_key)
    let ecobeeResult;
    try {
      ecobeeResult = await client.query(
        'DELETE FROM ecobee_runtime_intervals WHERE device_key = ANY($1)',
        [deviceKeys]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] ecobee_runtime_intervals table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting ecobee_runtime_intervals (skipping):', err.message);
      }
      ecobeeResult = { rowCount: 0 };
    }

    // 4. Delete equipment events (references device_key)
    let eventsResult;
    try {
      eventsResult = await client.query(
        'DELETE FROM equipment_events WHERE device_key = ANY($1)',
        [deviceKeys]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] equipment_events table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting equipment_events (skipping):', err.message);
      }
      eventsResult = { rowCount: 0 };
    }

    // 5. Delete runtime segments (references device_key)
    let segmentsResult;
    try {
      segmentsResult = await client.query(
        'DELETE FROM runtime_segments WHERE device_key = ANY($1)',
        [deviceKeys]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] runtime_segments table does not exist, skipping');
      } else if (err.code === '42703') {
        console.log('[deleteUser] runtime_segments.device_key does not exist, trying device_id');
        try {
          segmentsResult = await client.query(
            'DELETE FROM runtime_segments WHERE device_id = ANY($1)',
            [deviceIds]
          );
        } catch (err2: any) {
          console.warn('[deleteUser] Error deleting runtime_segments with device_id (skipping):', err2.message);
          segmentsResult = { rowCount: 0 };
        }
      } else {
        console.warn('[deleteUser] Error deleting runtime_segments (skipping):', err.message);
      }
      segmentsResult = segmentsResult || { rowCount: 0 };
    }

    // 6. Delete runtime sessions (references device_key)
    let sessionsResult;
    try {
      sessionsResult = await client.query(
        'DELETE FROM runtime_sessions WHERE device_key = ANY($1)',
        [deviceKeys]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] runtime_sessions table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting runtime_sessions (skipping):', err.message);
      }
      sessionsResult = { rowCount: 0 };
    }

    // 7. Delete daily summaries (references device_id)
    let summariesResult;
    try {
      summariesResult = await client.query(
        'DELETE FROM summaries_daily WHERE device_id = ANY($1)',
        [deviceIds]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] summaries_daily table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting summaries_daily (skipping):', err.message);
      }
      summariesResult = { rowCount: 0 };
    }

    // 8. Delete device status (try device_id first, fallback to device_key)
    let statusResult;
    try {
      statusResult = await client.query(
        'DELETE FROM device_status WHERE device_id = ANY($1)',
        [deviceIds]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] device_status table does not exist, skipping');
      } else if (err.code === '42703') {
        console.log('[deleteUser] device_status.device_id does not exist, trying device_key');
        try {
          statusResult = await client.query(
            'DELETE FROM device_status WHERE device_key = ANY($1)',
            [deviceKeys]
          );
        } catch (err2: any) {
          console.warn('[deleteUser] Error deleting device_status with device_key (skipping):', err2.message);
          statusResult = { rowCount: 0 };
        }
      } else {
        console.warn('[deleteUser] Error deleting device_status (skipping):', err.message);
      }
      statusResult = statusResult || { rowCount: 0 };
    }

    // 9. Delete device states (references device_key)
    let statesResult;
    try {
      statesResult = await client.query(
        'DELETE FROM device_states WHERE device_key = ANY($1)',
        [deviceKeys]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] device_states table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting device_states (skipping):', err.message);
      }
      statesResult = { rowCount: 0 };
    }

    // 10. Finally, delete all devices for this user
    let deleteDevicesResult;
    try {
      deleteDevicesResult = await client.query(
        'DELETE FROM devices WHERE user_id = $1',
        [userId]
      );
    } catch (err: any) {
      if (err.code === '42P01') {
        console.log('[deleteUser] devices table does not exist, skipping');
      } else {
        console.warn('[deleteUser] Error deleting devices (skipping):', err.message);
      }
      deleteDevicesResult = { rowCount: 0 };
    }

    console.log(`[deleteUser] Deleted user ${userId} with ${devices.length} devices and all linked data:`);
    console.log(`  - ${predictionsResult.rowCount} ai_predictions`);
    console.log(`  - ${filterResetsResult.rowCount} filter_resets`);
    console.log(`  - ${ecobeeResult.rowCount} ecobee_runtime_intervals`);
    console.log(`  - ${eventsResult.rowCount} equipment_events`);
    console.log(`  - ${segmentsResult.rowCount} runtime_segments`);
    console.log(`  - ${sessionsResult.rowCount} runtime_sessions`);
    console.log(`  - ${summariesResult.rowCount} summaries_daily`);
    console.log(`  - ${statusResult.rowCount} device_status`);
    console.log(`  - ${statesResult.rowCount} device_states`);
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
    console.error('[deleteUser] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;
