import { Pool } from 'pg';

export async function runWorker(
  pool: Pool,
  workerName: string,
  workerFn: (pool: Pool) => Promise<void>
) {
  const startTime = Date.now();
  console.log(`⚙️  Starting worker: ${workerName}...`);

  let success = false;
  let errorMessage: string | null = null;

  try {
    await workerFn(pool);
    success = true;
  } catch (err: any) {
    errorMessage = err.message;
    console.error(`❌ Worker ${workerName} failed:`, err.message);
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    try {
      await pool.query(
        `INSERT INTO worker_runs (worker_name, started_at, finished_at, duration_seconds, success, error_message)
         VALUES ($1, NOW(), NOW(), $2, $3, $4)`,
        [workerName, duration, success, errorMessage]
      );
      console.log(
        `🕒 Worker run logged: ${workerName} (${duration.toFixed(2)}s, success=${success})`
      );
    } catch (logErr: any) {
      console.error(`⚠️  Failed to log worker run for ${workerName}:`, logErr.message);
    }
  }

  if (success) console.log(`✅ Worker ${workerName} completed successfully.`);
}
