import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { pool } from './db/pool';
import { ensureSchema } from './db/ensureSchema';
import ingestRouter from './routes/ingest';

// ✅ Standardized worker imports
import { runSessionStitcher } from './workers/sessionStitcher';
import { runSummaryWorker } from './workers/summaryWorker';
import { runRegionAggregationWorker } from './workers/regionAggregationWorker';
import { runAIWorker } from './workers/aiWorker';

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

// ✅ Health check route
app.get('/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.status(200).json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    console.error('[server] Health check error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Ingest routes (mounted at /ingest)
app.use('/ingest', ingestRouter);

// ✅ Worker endpoints
app.get('/workers/run-all', async (_req, res) => {
  console.log('[workers] Running all workers sequentially...');
  const results: any[] = [];

  try {
    const sessionResult = await runSessionStitcher();
    results.push({ worker: 'sessionStitcher', result: sessionResult });

    const summaryResult = await runSummaryWorker();
    results.push({ worker: 'summaryWorker', result: summaryResult });

    const regionResult = await runRegionAggregationWorker();
    results.push({ worker: 'regionAggregationWorker', result: regionResult });

    const aiResult = await runAIWorker();
    results.push({ worker: 'aiWorker', result: aiResult });

    res.status(200).json({ ok: true, results });
  } catch (err: any) {
    console.error('[workers/run-all] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Individual worker routes
app.get('/workers/session-stitcher', async (_req, res) => {
  const result = await runSessionStitcher();
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/workers/summary', async (_req, res) => {
  const result = await runSummaryWorker();
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/workers/region', async (_req, res) => {
  const result = await runRegionAggregationWorker();
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/workers/ai', async (_req, res) => {
  const result = await runAIWorker();
  res.status(result.ok ? 200 : 500).json(result);
});

// ✅ Start server after ensuring schema
(async () => {
  try {
    await ensureSchema(pool); // <-- Fixed argument
    console.log('✅ Database schema verified.');
  } catch (err: any) {
    console.error('❌ Error ensuring schema:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 SmartFilterPro Core Ingest Service running on port ${PORT}`);
  });
})();
