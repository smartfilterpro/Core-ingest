import express, { Request, Response } from "express";
import { pool } from "../db/pool";

const router = express.Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT NOW() AS db_time");
    res.status(200).json({
      status: "ok",
      service: "smartfilterpro-core-ingest",
      db_connected: true,
      db_time: result.rows[0].db_time,
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Health check failed:", err.message);
    res.status(500).json({
      status: "error",
      db_connected: false,
      message: err.message,
    });
  }
});

export default router;
