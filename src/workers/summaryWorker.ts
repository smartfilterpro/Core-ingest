import { Pool } from 'pg';

export async function runSummaryWorker(pool: Pool) {
  console.log('📊 Starting enhanced daily summary worker...');

  const query = `
    WITH daily AS (
      SELECT
        rs.device_key,  -- ← Changed from device_id
        DATE(rs.started_at) AS date,  -- ← Changed from start_time
        SUM(rs.duration_seconds)::INT AS runtime_seconds_total,
        COUNT(*) AS runtime_sessions_count,
        AVG(rs.duration_seconds)::NUMERIC AS avg_runtime,
        AVG(ev.last_temperature)::NUMERIC AS avg_temperature  -- ← Changed from temperature_f
      FROM runtime_sessions rs
      LEFT JOIN equipment_events ev
        ON rs.device_key = ev.device_key
        AND ev.recorded_at BETWEEN rs.started_at AND rs.ended_at  -- ← Changed from event_timestamp
      WHERE rs.started_at >= CURRENT_DATE - INTERVAL '7 days'  -- ← Changed from start_time
        AND rs.ended_at IS NOT NULL
      GROUP BY rs.device_key, DATE(rs.started_at)
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
      daily.date,
      daily.runtime_seconds_total,
      daily.runtime_sessions_count,
      daily.avg_temperature,
      NOW()
    FROM daily
    JOIN devices d ON d.device_key = daily.device_key
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
      runtime_sessions_count = EXCLUDED.runtime_sessions_count,
      avg_temperature = EXCLUDED.avg_temperature,
      updated_at = NOW();
  `;

  try {
    const result = await pool.query(query);
    console.log(`✅ Daily summary aggregation complete. ${result.rowCount ?? 0} records updated.`);
    return { success: true, records: result.rowCount ?? 0 };
  } catch (err: any) {
    console.error('❌ Summary worker error:', err.message);
    return { success: false, error: err.message };
  }
}
