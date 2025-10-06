import express from 'express';
import dotenv from 'dotenv';
import { pool } from './db/pool.js'; // ✅ Use shared pool
import { runWorker } from './utils/runWorker.js';
import { sessionStitcher } from './workers/sessionStitcher.js';
import { summaryWorker } from './workers/summaryWorker.js';
import { regionAggregationWorker } from './workers/regionAggregationWorker.js';
import { aiWorker } from './workers/aiWorker.js';
import { ingestRouter } from './routes/ingest.js';
import filterResetRouter from './routes/filterReset.js';
import bubbleSyncRouter from './routes/bubbleSync.js';
import healthRouter from './routes/health.js';
import { bubbleSummarySync } from './workers/bubbleSummarySync.js';
import { deviceStatusRouter } from './routes/deviceStatus.js';
import { heartbeatWorker } from './workers/heartbeatWorker.js';



dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ===== ROUTES =====
app.use('/ingest', ingestRouter);
app.use('/filter-reset', filterResetRouter);
app.use('/bubble', bubbleSyncRouter);
app.use('/health', healthRouter);
app.use('/ingest', deviceStatusRouter);  // ✅ new


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

// ✅ Bubble Summary Sync Worker
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
// ===== Combined "Run All" Worker =====
app.get('/workers/run-all', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DB not connected' });
  }

  try {
    console.log('🚀 Starting full data pipeline...');

    // 1️⃣ Session Stitcher → create runtime_sessions from equipment_events
    await runWorker(pool, 'sessionStitcher', sessionStitcher);

    // 2️⃣ Daily Summary → aggregate runtime_sessions into summaries_daily
    await runWorker(pool, 'summaryWorker', summaryWorker);

    // 3️⃣ Regional Aggregation → create region_averages from summaries_daily
    await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);

    // 4️⃣ AI Worker → generate predictions in ai_predictions
    await runWorker(pool, 'aiWorker', aiWorker);

    // 5️⃣ Bubble Sync → send daily summaries back to Bubble.io
    await bubbleSummarySync();

    // 6️⃣ Heartbeat Worker → mark devices offline if inactive > 60 mins
    await heartbeatWorker(pool);

    console.log('✅ Full data pipeline completed.');
    res.json({ ok: true, message: 'Full data pipeline completed' });
  } catch (err: any) {
    console.error('[Run-All Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/workers/heartbeat', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  const result = await heartbeatWorker(pool);
  res.json({ ok: true, result });
});


// ===== START SERVER =====
async function start() {
  app.listen(PORT, () => {
    console.log(`🧠 SmartFilterPro Core Ingest Service running on port ${PORT}`);
  });
}

start();
