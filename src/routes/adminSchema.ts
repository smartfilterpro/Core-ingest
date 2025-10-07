import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

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
      message: 'equipment_events schema fixed - id is now UUID, recorded_at added' 
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/add-unique-constraints', async (_req: Request, res: Response) => {
  try {
    // Add unique constraint to source_event_id
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_events_source_event_id 
      ON equipment_events(source_event_id) 
      WHERE source_event_id IS NOT NULL;
    `);
    
    res.json({ 
      ok: true, 
      message: 'Unique constraint added to source_event_id' 
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/fix-unique-constraint', async (_req: Request, res: Response) => {
  try {
    // Drop the partial index
    await pool.query(`
      DROP INDEX IF EXISTS idx_equipment_events_source_event_id;
    `);
    
    // Create a proper unique constraint (not partial)
    await pool.query(`
      ALTER TABLE equipment_events 
      ADD CONSTRAINT equipment_events_source_event_id_unique 
      UNIQUE (source_event_id);
    `);
    
    res.json({ 
      ok: true, 
      message: 'Fixed: source_event_id now has proper unique constraint' 
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
