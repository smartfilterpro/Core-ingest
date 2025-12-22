import express, { Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import axios from "axios";

const router = express.Router();

/**
 * Manual or programmatic filter reset endpoint.
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { device_id, user_id, source = "manual" } = req.body;

  if (!device_id || !user_id) {
    return res.status(400).json({ success: false, error: "Missing device_id or user_id" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get device_key for this device_id
    const deviceResult = await client.query(
      `SELECT device_key FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Device not found" });
    }

    const device_key = deviceResult.rows[0].device_key;

    // 1. Insert filter reset record
    await client.query(
      `INSERT INTO filter_resets (device_id, user_id, source, triggered_at)
       VALUES ($1, $2, $3, NOW())`,
      [device_id, user_id, source]
    );

    // 2. Update device_states to reset filter tracking
    await client.query(
      `UPDATE device_states
       SET last_reset_ts = NOW(),
           hours_used_total = 0,
           filter_hours_used = 0,
           updated_at = NOW()
       WHERE device_key = $1`,
      [device_key]
    );

    // 3. Reset filter_usage_percent in devices table
    await client.query(
      `UPDATE devices
       SET filter_usage_percent = 0, updated_at = NOW()
       WHERE device_id = $1`,
      [device_id]
    );

    await client.query("COMMIT");

    console.log(`[filterReset] ✅ Filter reset for device ${device_id} (${device_key})`);

    // Optional Bubble sync
    if (process.env.BUBBLE_SYNC_URL) {
      try {
        await axios.post(process.env.BUBBLE_SYNC_URL, {
          event: "filter_reset",
          device_id,
          user_id,
          timestamp: new Date().toISOString(),
        });
      } catch (syncErr: any) {
        console.error("[filterReset] Bubble sync failed:", syncErr.message);
        // Don't fail the request if sync fails
      }
    }

    res.status(200).json({ success: true, message: "Filter reset recorded" });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Error in /filter-reset:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

export default router;
