router.post('/add-unique-constraints', async (_req, res) => {
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
