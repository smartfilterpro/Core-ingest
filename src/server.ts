import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { ensureSchema } from './db/ensureSchema';
import { runWorker } from './utils/runWorker';
import { regionAggregationWorker } from './workers/regionAggregationWorker';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL || '';
const ENABLE_DATABASE = process.env.ENABLE_DATABASE !== '0';

let pool: Pool | null = null;

// ✅ Initialize Postgres connection
if (ENABLE_DATABASE && DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => console.error('Database pool error:', err.message));
  console.log('✅ Connected to Postgres');
} else {
  console.warn('⚠️ Database not enabled (ENABLE_DATABASE=0)');
}

// ✅ Health route
app.get('/health', async (req, res) => {
  try {
    if (pool) await pool.query('SELECT 1');
    res.json({ ok: true, message: 'SmartFilterPro Core Ingest healthy' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Filter reset route
app.post('/filter-reset', async (req, res) => {
  const { device_id } = req.body;
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  if (!device_id) return res.status(400).json({ error: 'Missing device_id' });

  try {
    await pool.query(
      `INSERT INTO filter_resets (device_id, reset_timestamp) VALUES ($1, NOW())`,
      [device_id]
    );
    res.json({ ok: true, message: `Filter reset recorded for ${device_id}` });
  } catch (err: any) {
    console.error('❌ Filter reset error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Manual trigger for region aggregation
app.get('/workers/region-aggregate', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB not connected' });
  await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  res.json({ ok: true, message: 'Region aggregation complete' });
});

// ✅ Startup sequence
async function start() {
  if (pool) {
    console.log('✅ Connected to database');
    await ensureSchema(pool);
    console.log('✅ Database schema ensured');

    // Optional immediate worker run on startup (can disable in production)
    await runWorker(pool, 'regionAggregationWorker', regionAggregationWorker);
  }

  app.listen(PORT, () => {
    console.log(`🚀 SmartFilterPro Core Ingest running on port ${PORT}`);
  });
}

start();
