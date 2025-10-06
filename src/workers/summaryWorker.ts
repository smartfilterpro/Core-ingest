import { Pool } from 'pg';

export async function summaryWorker(pool: Pool) {
  console.log('📊 Starting enhanced daily summary worker...');

  const query = `
    WITH daily AS (
      SELECT
        rs.device_id,
        DATE(rs.start_time) AS date,
        SUM(rs.runtime_seconds)::INT AS runtime_seconds_total,
        COUNT(*) AS runtime_sessions_count,
        AVG(rs.runtime_seconds)::NUMERIC AS avg_runtime,
        AVG(ev.temperature_f)::NUMERIC AS avg_temperature
      FROM runtime_sessions rs
      LEFT JOIN equipment_events ev
        ON rs.device_id = ev.device_id
        AND ev.event_timestamp BETWEEN rs.start_time AND rs.end_time
      WHERE rs.start_time >= CURRENT_DATE - INTERVAL '2 days'
      GROUP BY rs.device_id, DATE(rs.start_time)
    )
    INSERT INTO summaries_daily (
      device_id,
      date,
      runtime_seconds_total,
      runtime_sessions_count,
      avg_temperature,
      updated_at
    )
    SELECT
      d.device_id,
      d.date,
      d.runtime_seconds_total,
      d.runtime_sessions_count,
      d.avg_temperature,
      NOW()
    FROM daily d
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
      runtime_sessions_count = EXCLUDED.runtime_sessions_count,
      avg_temperature = EXCLUDED.avg_temperature,
      updated_at = NOW();
  `;

  const result = await pool.query(query);
  console.log(`✅ Daily summary aggregation complete. ${result.rowCount ?? 0} records updated.`);
}
