import { Pool } from 'pg';

export async function summaryWorker(pool: Pool) {
  console.log('📊 Starting daily summary worker...');

  const query = `
    WITH daily AS (
      SELECT
        device_id,
        DATE(start_time) AS date,
        SUM(runtime_seconds)::INT AS runtime_seconds_total,
        COUNT(*) AS runtime_sessions_count,
        AVG(runtime_seconds)::NUMERIC AS avg_runtime
      FROM runtime_sessions
      WHERE start_time >= CURRENT_DATE - INTERVAL '2 days'
      GROUP BY device_id, DATE(start_time)
    )
    INSERT INTO summaries_daily (device_id, date, runtime_seconds_total, runtime_sessions_count, updated_at)
    SELECT
      d.device_id,
      d.date,
      d.runtime_seconds_total,
      d.runtime_sessions_count,
      NOW()
    FROM daily d
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
      runtime_sessions_count = EXCLUDED.runtime_sessions_count,
      updated_at = NOW();
  `;

  const result = await pool.query(query);
  console.log(`✅ Daily summary aggregation complete. ${result.rowCount ?? 0} records updated.`);
}
