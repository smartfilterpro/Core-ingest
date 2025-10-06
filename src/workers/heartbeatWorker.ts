import { Pool } from 'pg';

const OFFLINE_THRESHOLD_MINUTES = parseInt(process.env.OFFLINE_THRESHOLD_MINUTES || '60');

/**
 * Marks devices as offline if they haven't checked in within OFFLINE_THRESHOLD_MINUTES.
 */
export async function heartbeatWorker(pool: Pool) {
  console.log(`💓 Starting Heartbeat Worker (threshold: ${OFFLINE_THRESHOLD_MINUTES} minutes)...`);

  const query = `
    UPDATE device_status
    SET is_reachable = false,
        updated_at = NOW()
    WHERE is_reachable = true
      AND last_seen_at < NOW() - INTERVAL '${OFFLINE_THRESHOLD_MINUTES} minutes';
  `;

  try {
    const result = await pool.query(query);
    console.log(`⚙️ Heartbeat Worker: ${result.rowCount ?? 0} devices marked unreachable.`);
    return { success: true, updated: result.rowCount ?? 0 };
  } catch (err: any) {
    console.error('[HeartbeatWorker] Error:', err);
    return { success: false, error: err.message };
  }
}
