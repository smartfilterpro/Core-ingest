import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * 1️⃣ Fix equipment_events ID and recorded_at defaults
 */
router.post('/fix-equipment-events', async (_req: Request, res: Response) => {
  try {
    // Step 1: Drop the existing default
    await pool.query(`
      ALTER TABLE equipment_events 
      ALTER COLUMN id DROP DEFAULT;
    `);

    // Step 2: Change type to UUID
    await pool.query(`
      ALTER TABLE equipment_events 
      ALTER COLUMN id TYPE UUID USING gen_random_uuid();
    `);

    // Step 3: Set new UUID default
    await pool.query(`
      ALTER TABLE equipment_events 
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
    `);

    // Step 4: Add recorded_at if missing
    await pool.query(`
      ALTER TABLE equipment_events 
      ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    res.json({
      ok: true,
      message: 'equipment_events schema fixed - id is UUID, recorded_at ensured'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 2️⃣ Add partial unique index on source_event_id (legacy)
 */
router.post('/add-unique-constraints', async (_req: Request, res: Response) => {
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_events_source_event_id 
      ON equipment_events(source_event_id) 
      WHERE source_event_id IS NOT NULL;
    `);

    res.json({
      ok: true,
      message: 'Unique partial index added on source_event_id'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 3️⃣ Fix source_event_id unique constraint (legacy replacement)
 */
router.post('/fix-unique-constraint', async (_req: Request, res: Response) => {
  try {
    await pool.query(`
      DROP INDEX IF EXISTS idx_equipment_events_source_event_id;
    `);

    await pool.query(`
      ALTER TABLE equipment_events 
      ADD CONSTRAINT equipment_events_source_event_id_unique 
      UNIQUE (source_event_id);
    `);

    res.json({
      ok: true,
      message: 'source_event_id unique constraint applied'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 4️⃣ Fix observed_at defaults
 */
router.post('/fix-observed-at', async (_req: Request, res: Response) => {
  try {
    await pool.query(`
      ALTER TABLE equipment_events 
      ALTER COLUMN observed_at DROP NOT NULL;
    `);

    await pool.query(`
      ALTER TABLE equipment_events 
      ALTER COLUMN observed_at SET DEFAULT NOW();
    `);

    res.json({
      ok: true,
      message: 'observed_at column now nullable with default NOW()'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 5️⃣ Add dedupe constraint for safety: (device_key, source_event_id)
 */
router.post('/fix-dedupe-safety', async (_req: Request, res: Response) => {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'unique_device_event'
        ) THEN
          ALTER TABLE equipment_events
          ADD CONSTRAINT unique_device_event UNIQUE (device_key, source_event_id);
        END IF;
      END
      $$;
    `);

    res.json({
      ok: true,
      message: '✅ Added dedupe constraint: unique_device_event (device_key, source_event_id)'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 6️⃣ Add performance index for faster queries
 */
router.post('/add-device-event-index', async (_req: Request, res: Response) => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_equipment_events_device_event
      ON equipment_events (device_key, recorded_at DESC);
    `);

    res.json({
      ok: true,
      message: '✅ Added index idx_equipment_events_device_event on (device_key, recorded_at DESC)'
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
