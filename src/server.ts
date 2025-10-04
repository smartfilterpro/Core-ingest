import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { ensureSchema } from './db/ensureSchema';
import { runWorker } from './utils/runWorker';
import { sessionStitcher } from './workers/sessionStitcher';
import { summaryWorker } from './workers/summaryWorker';
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
  if (!
