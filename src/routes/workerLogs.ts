import express from 'express';
import { pool } from '../db/pool.js';

export const workerLogsRouter = express.Router();

/**
 * GET /workers/logs
 * Returns the most recent worker run records.
 * Query params:
 *   ?limit=20  (optional)
 */
workerLogsRouter.get('/logs', async (req, res) => {
  const limit = parseInt((req.query.limit as string) || '20');

  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         worker_name,
         status,
         success,
         started_at,
         completed_at,
         duration_seconds,
         devices_processed,
         success_count,
         fail_count
       FROM worker_runs
       ORDER BY started_at DESC
       LIMIT $1;`,
      [limit]
    );

    res.json({ ok: true, count: rows.length, runs: rows });
  } catch (err: any) {
    console.error('[WorkerLogs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
