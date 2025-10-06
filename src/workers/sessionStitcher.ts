import { Pool } from 'pg';

const LAST_FAN_TAIL_SECONDS = parseInt(process.env.LAST_FAN_TAIL_SECONDS || '120');

export async function sessionStitcher(pool: Pool) {
  console.log('🧵 Starting session stitcher (enhanced)...');

  const query = `
    WITH ordered AS (
      SELECT
        device_id,
        event_timestamp,
        equipment_status,
        is_active,
        LAG(equipment_status) OVER (PARTITION BY device_id ORDER BY event_timestamp) AS prev_equipment_status,
        LAG(event_timestamp) OVER (PARTITION BY device_id ORDER BY event_timestamp) AS prev_timestamp
      FROM equipment_events
      WHERE event_timestamp >= CURRENT_DATE - INTERVAL '2 days'
    ),
    transitions AS (
      SELECT
        device_id,
        prev_equipment_status,
        equipment_status,
        prev_timestamp AS start_time,
        event_timestamp AS end_time
      FROM ordered
      WHERE prev_equipment_status IN ('HEATING','COOLING','FAN') 
        AND equipment_status IN ('OFF','IDLE')
        AND prev_timestamp IS NOT NULL
    )
    INSERT INTO runtime_sessions (
      device_id,
      start_time,
      end_time,
      runtime_seconds,
      last_mode,
      created_at
    )
    SELECT
      t.device_id,
      t.start_time,
      t.end_time,
      GREATEST(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) + ${LAST_FAN_TAIL_SECONDS}, 0)::INT AS runtime_seconds,
      CASE 
        WHEN t.prev_equipment_status = 'HEATING' THEN 'HEAT'
        WHEN t.prev_equipment_status = 'COOLING' THEN 'COOL'
        WHEN t.prev_equipment_status = 'FAN' THEN 'FAN'
        ELSE 'AUTO'
      END AS last_mode,
      NOW()
    FROM transitions t
    ON CONFLICT DO NOTHING;
  `; // ✅ ← This closing backtick was missing

  const result = await pool.query(query);
  console.log(`✅ Session stitching complete. ${result.rowCount ?? 0} new sessions created.`);
}
