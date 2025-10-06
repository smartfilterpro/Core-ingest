import express from 'express';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { runWorker } from './utils/runWorker.js';
import { sessionStitcher } from './workers/sessionStitcher.js';
import { summaryWorker } from './workers/summaryWorker.js';
import { regionAggregationWorker } from './workers/regionAggregationWorker.js';
import { aiWorker } from './workers/aiWorker.js';
import { ingestRouter } from './routes/ingest.js';
import filterResetRouter from './routes/filterReset.js';
import bubbleSyncRouter from './routes/bubbleSync.js';
import healthRouter from './routes/health.js';
import { bubbleSummarySync } from './workers/bubbleSummarySync.js'; // ✅ NEW

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const ENABLE_DATABASE = process.env.ENABLE_DATABASE !== '0';
const DATABASE_URL = process.env.DATABASE_URL;

let pool: Pool | null = null;

if (ENABLE_DATABASE && DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Database pool error:', err.message);
  });
}

// ===== ROUTES =====
app.use('/ingest', ingestRouter);
app.use('/filter-reset', filterResetRouter);
app.use('/bubble', bubbleSyncRouter);
app.use('/health', healthRouter);

// ===== WORKERS =====
app.get('/workers/session-stitch', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'sessionStitcher', sessionStitcher);
  res.json({ ok: true });
});

app.get('/workers/daily-summary', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'summaryWorker', summaryWorker);
  res.json({ ok: true });
});

app.get('/workers/region-aggregate', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  res.json({ ok: true });
});

app.get('/workers/ai', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'aiWorker', aiWorker);
  res.json({ ok: true });
});

// ✅ NEW: Bubble Summary Sync Worker (Core → Bubble)
app.post('/workers/bubble-sync', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  try {
    const result = await bubbleSummarySync();
    res.json({ ok: true, result });
  } catch (err: any) {
    console.error('[bubbleSummarySync] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== Combined "Run All" Worker =====
app.get('/workers/run-all', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });

  await runWorker(pool, 'sessionStitcher', sessionStitcher);
  await runWorker(pool, 'summaryWorker', summaryWorker);
  await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  await runWorker(pool, 'aiWorker', aiWorker);
  await bubbleSummarySync(); // ✅ Added here for automatic Bubble sync

  res.json({ ok: true, message: 'Full data pipeline completed' });
});

// ===== START SERVER =====
async function start() {
  app.listen(PORT, () => {
    console.log(`🧠 SmartFilterPro Core Ingest Service running on port ${PORT}`);
  });
}

start();
