import { Pool } from 'pg';

export async function runWorker(
  pool: Pool,
  workerName: string,
  workerFn: (pool: Pool) => Promise<any>
) {
  const startTime = Date.now();
  console.log(`⚙️ Starting worker: ${workerName}`);

  const { rows } = await pool.query(
    `INSERT INTO worker_runs (worker_name, started_at, status)
     VALUES ($1, NOW(), 'running')
     RETURNING id`,
    [workerName]
  );
  const runId = rows[0].id;

  try {
    const result = await workerFn(pool);
    const duration = (Date.now() - startTime) / 1000;
    const success = result?.success !== false;

    await pool.query(
      `UPDATE worker_runs
       SET completed_at = NOW(),
           status = 'success',
           devices_processed = COALESCE($2, 0),
           success_count = COALESCE($3, 0),
           fail_count = COALESCE($4, 0),
           duration_seconds = $5,
           success = $6
       WHERE id = $1`,
      [runId, result?.devices_processed, result?.success_count, result?.fail_count, duration, success]
    );

    console.log(`✅ Worker ${workerName} finished in ${duration.toFixed(2)}s`);
  } catch (err: any) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`❌ Worker ${workerName} failed:`, err.message);

    await pool.query(
      `UPDATE worker_runs
       SET completed_at = NOW(),
           status = 'failed',
           duration_seconds = $2,
           success = false
       WHERE id = $1`,
      [runId, duration]
    );
  }
}
