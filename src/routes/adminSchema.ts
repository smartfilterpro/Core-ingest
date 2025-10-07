import express from 'express';
import { pool } from '../db/pool';

const router = express.Router();

router.post('/fix-equipment-events', async (_req, res) => {
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

export default router;
