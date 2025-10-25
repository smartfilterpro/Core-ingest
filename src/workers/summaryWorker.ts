// src/workers/summaryWorker.ts
import { Pool } from 'pg';

export async function runSummaryWorker(pool: Pool) {
  console.log('📊 Starting daily summary worker...');
  const query = `
    WITH daily AS (
      SELECT
        d.device_id,
        DATE(rs.started_at) AS date,
        SUM(COALESCE(rs.runtime_seconds, 0))::INT AS runtime_seconds_total,
        COUNT(*) AS runtime_sessions_count,
        AVG(COALESCE(rs.runtime_seconds, 0))::NUMERIC AS avg_runtime,
        AVG(ev.last_temperature)::NUMERIC AS avg_temperature,
        AVG(ev.last_humidity)::NUMERIC AS avg_humidity
      FROM runtime_sessions rs
      JOIN devices d ON d.device_key = rs.device_key
      LEFT JOIN equipment_events ev
        ON rs.device_key = ev.device_key
        AND ev.recorded_at BETWEEN rs.started_at AND COALESCE(rs.ended_at, rs.started_at)
      WHERE rs.started_at >= CURRENT_DATE - INTERVAL '7 days'
        AND rs.started_at IS NOT NULL
        AND d.device_id IS NOT NULL
      GROUP BY d.device_id, DATE(rs.started_at)
    )
    INSERT INTO summaries_daily (
      device_id,
      date,
      runtime_seconds_total,
      runtime_sessions_count,
      avg_temperature,
      avg_humidity,
      updated_at
    )
    SELECT
      device_id,
      date,
      runtime_seconds_total,
      runtime_sessions_count,
      avg_temperature,
      avg_humidity,
      NOW()
    FROM daily
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
      runtime_sessions_count = EXCLUDED.runtime_sessions_count,
      avg_temperature = EXCLUDED.avg_temperature,
      avg_humidity = EXCLUDED.avg_humidity,
      updated_at = NOW();
  `;
  try {
    const result = await pool.query(query);
    console.log(`✅ Summary worker complete. ${result.rowCount ?? 0} records updated.`);
    return { success: true, records: result.rowCount ?? 0 };
  } catch (err: any) {
    console.error('❌ Summary worker error:', err.message);
    return { success: false, error: err.message };
  }
}
