import express from "express";
import dotenv from "dotenv";
import { pool } from "./db/pool";

import bodyParser from "body-parser";


import { ingest } from "./routes/ingest.js";


dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: "2mb" }));
app.use(health);
app.use(ingest);
app.use(filterReset);

// Global error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error({ err }, "Unhandled server error");
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    logger.info(`✅ Core Ingest API running on port ${PORT}`);
  } catch (err) {
    logger.error({ err }, "❌ Database connection failed");
  }
});
