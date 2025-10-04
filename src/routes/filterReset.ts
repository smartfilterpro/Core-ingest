import express, { Request, Response } from "express";
import { pool } from "../db/pool";
import axios from "axios";

const router = express.Router();

/**
 * Endpoint to manually trigger a filter reset for a device.
 * Future: may also update filter_resets table or call Bubble.
 */
router.post("/", async (req: Request, res: Response) => {
  const { device_id, user_id } = req.body;

  if (!device_id || !user_id) {
    return res.status(400).json({ success: false, error: "Missing device_id or user_id" });
  }

  try {
    await pool.query(
      `INSERT INTO filter_resets (device_id, user_id, triggered_at)
       VALUES ($1, $2, NOW())`,
      [device_id, user_id]
    );

    // Optionally notify Bubble (if you have an endpoint for it)
    if (process.env.BUBBLE_SYNC_URL) {
      await axios.post(process.env.BUBBLE_SYNC_URL, {
        event: "filter_reset",
        device_id,
        user_id,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({ success: true, message: "Filter reset recorded" });
  } catch (err: any) {
    console.error("Error in /filter-reset:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
