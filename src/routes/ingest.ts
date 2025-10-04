import express, { Request, Response } from "express";
import { pool } from "../db/pool";

const router = express.Router();

/**
 * Ingest endpoint — receives batched normalized events from vendor services.
 */
router.post("/v1/events:batch", async (req: Request, res: Response) => {
  const events = req.body?.events || [];

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ success: false, error: "Missing events array" });
  }

  try {
    const client = await pool.connect();
    const insertQuery = `
      INSERT INTO equipment_events (
        device_id,
        event_type,
        is_active,
        current_temp,
        timestamp
      ) VALUES ($1, $2, $3, $4, $5)
    `;

    for (const e of events) {
      await client.query(insertQuery, [
        e.device_id,
        e.event_type,
        e.is_active,
        e.current_temp,
        e.timestamp,
      ]);
    }

    client.release();
    console.log(`✅ Ingested ${events.length} events`);
    res.status(200).json({ success: true, count: events.length });
  } catch (err: any) {
    console.error("❌ Ingest error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
