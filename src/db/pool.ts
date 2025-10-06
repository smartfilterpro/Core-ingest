import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLE_DATABASE = process.env.ENABLE_DATABASE !== '0';

export const pool = ENABLE_DATABASE && DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

if (pool) {
  pool.on('connect', () => console.log('✅ Connected to Postgres'));
  pool.on('error', (err: Error) => console.error('Database pool error:', err.message));
}

/**
 * Optional helper for legacy imports that expected getPool()
 */
export function getPool(): Pool {
  if (!pool) throw new Error('Database pool is not initialized');
  return pool;
}
