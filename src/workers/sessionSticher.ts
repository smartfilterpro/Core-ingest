import { Pool } from 'pg';

const LAST_FAN_TAIL_SECONDS = parseInt(process.env.LAST_FAN_TAIL_SECONDS || '120');

export async function sessionStitcher(pool: Pool) {
  console.log('🧵 Starting session stitcher...');

  const query = `
    WITH ordered AS (
      SELECT
        device_id,
        event_timestamp,
        is_active,
        LAG(is_active) OVER (PARTITION BY device_id ORDER BY event_timestamp) AS prev_active,
        LAG(event_timestamp) OVER (PARTITION BY device_id ORDER BY event_timestamp) AS prev_timestamp
      FROM equipment_events
      WHERE event_timestamp >= CURRENT_DATE - INTERVAL '2 days'
    ),
    transitions AS (
      SELECT
        device_id,
        prev_timestamp AS start_time,
        event_timestamp AS end_time
      FROM ordered
      WHERE prev_active = TRUE AND is_active = FALSE
    )
    INSERT INTO runtime_sessions (device_id, start_time, end_time, runtime_seconds, last_mode)
    SELECT
      t.device_id,
      t.start_time,
      t.end_time,
      EXTRACT(EPOCH FROM (t.end_time - t.start_time)) + ${LAST_FAN_TAIL_SECONDS} AS runtime_seconds,
      'AUTO'
    FROM transitions t
    ON CONFLICT DO NOTHING;
  `;

  const result = await pool.query(query);
  console.log(`✅ Session stitching complete. ${result.rowCount ?? 0} new sessions created.`);
}
