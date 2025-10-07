import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLE_DATABASE = process.env.ENABLE_DATABASE !== '0';

if (!ENABLE_DATABASE || !DATABASE_URL) {
  throw new Error('[ERROR] Database not enabled or DATABASE_URL missing.');
}

export const pool: Pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => console.log('[OK] Connected to Postgres'));
pool.on('error', (err: Error) =>
  console.error('[ERROR] Database pool error:', err.message)
);

// Optional helper for legacy imports
export function getPool(): Pool {
  return pool;
}
