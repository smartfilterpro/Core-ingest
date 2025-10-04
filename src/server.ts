import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { ensureSchema } from './db/ensureSchema';
import { runWorker } from './utils/runWorker';
import { sessionStitcher } from './workers/sessionStitcher';
import { summaryWorker } from './workers/summaryWorker';
import { regionAggregationWorker } from './workers/regionAggregationWorker';
import { aiWorker } from './workers/aiWorker';  // 👈 make sure this import exists

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL || '';
const ENABLE_DATABASE = process.env.ENABLE_DATABASE !== '0';

let pool: Pool | null = null;

if (ENABLE_DATABASE && DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  console.log('✅ Connected to Postgres');
}

// ✅ Individual worker routes
app.get('/workers/session-stitch', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'sessionStitcher', sessionStitcher);
  res.json({ ok: true });
});

app.get('/workers/daily-summary', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'summaryWorker', summaryWorker);
  res.json({ ok: true });
});

app.get('/workers/region-aggregate', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  res.json({ ok: true });
});

//
// ✅ THIS IS THE RUN-ALL ROUTE — ADD IT HERE
//
app.get('/workers/run-all', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });

  console.log('🚀 Running full SmartFilterPro data pipeline...');
  await runWorker(pool, 'sessionStitcher', sessionStitcher);
  await runWorker(pool, 'summaryWorker', summaryWorker);
  await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  await runWorker(pool, 'aiWorker', aiWorker); // 👈 include AI worker here

  res.json({ ok: true, message: 'Full data pipeline completed' });
});

//
// ✅ Server startup
//
async function start() {
  if (pool) {
    await ensureSchema(pool);
  }
  app.listen(PORT, () => {
    console.log(`🚀 SmartFilterPro Core Ingest running on port ${PORT}`);
  });
}

start();