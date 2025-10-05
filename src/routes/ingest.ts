import express, { Request, Response } from "express";
import { pool } from "../db/pool";

const router = express.Router();

/**
 * Ingest endpoint — receives batched normalized events from vendor services.
 * Automatically upserts devices before inserting events.
 */
router.post("/v1/events:batch", async (req: Request, res: Response) => {
  const events = req.body?.events || [];

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ success: false, error: "Missing events array" });
  }

  const client = await pool.connect();

  try {
    for (const e of events) {
      // ✅ 1. Ensure the device exists
      await client.query(
        `
        INSERT INTO devices (device_id)
        VALUES ($1)
        ON CONFLICT (device_id) DO NOTHING
        `,
        [e.device_id]
      );

      // ✅ 2. Insert the equipment event
      await client.query(
        `
        INSERT INTO equipment_events (
          device_id,
          event_type,
          is_active,
          current_temp,
          event_timestamp
        ) VALUES ($1, $2, $3, $4, $5)
        `,
        [e.device_id, e.event_type, e.is_active, e.current_temp, e.timestamp]
      );
    }

    console.log(`✅ Ingested ${events.length} events`);
    res.status(200).json({ success: true, count: events.length });
  } catch (err: any) {
    console.error("❌ Ingest error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;