import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { pool } from "./db/pool";
import { startCronJobs } from './cron';

// Routes
import ingestRouter from "./routes/ingest";
import ingestV2Router from "./routes/ingestV2";
import healthRouter from "./routes/health";
import filterResetRouter from "./routes/filterReset";
import usersRouter from "./routes/users";
import { workerLogsRouter } from "./routes/workerLogs";
import { deviceStatusRouter } from "./routes/deviceStatus";
import adminSchemaRouter from "./routes/adminSchema";

// NEW ROUTES - Add these imports
import devicesRouter from "./routes/devices";
import runtimeSessionsRouter from "./routes/runtimeSessions";
import summariesRouter from "./routes/summaries";
import equipmentEventsRouter from "./routes/equipmentEvents";

// Workers + utilities
import { runSessionStitcher, runSummaryWorker, runRegionAggregationWorker, bubbleSummarySync, heartbeatWorker } from "./workers/index";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: "4mb" }));

/* ------------------------- Logging middleware -------------------------- */
app.use((req, _res, next) => {
  if (req.path.startsWith("/ingest"))
    console.log(`➡️  [${req.method}] ${req.path} (${req.ip})`);
  next();
});

/* --------------------------- Register routes --------------------------- */
app.use("/ingest", ingestRouter);
app.use("/ingest", ingestV2Router);
app.use("/health", healthRouter);
app.use("/filter-reset", filterResetRouter);
app.use("/users", usersRouter);
app.use("/workers/logs", workerLogsRouter);
app.use("/device-status", deviceStatusRouter);
app.use("/admin/schema", adminSchemaRouter);

// NEW ROUTES - Register them here
app.use("/devices", devicesRouter);
app.use("/runtime-sessions", runtimeSessionsRouter);
app.use("/summaries", summariesRouter);
app.use("/equipment-events", equipmentEventsRouter);

/* ---------------------------- Worker Trigger --------------------------- */
app.get("/workers/run-all", async (_req, res) => {
  console.log("[workers] Running all core workers sequentially...");
  const results: any[] = [];
  try {
    results.push({ worker: "sessionStitcher", result: await runSessionStitcher() });
    results.push({ worker: "summaryWorker", result: await runSummaryWorker(pool) });
    results.push({ worker: "regionAggregationWorker", result: await runRegionAggregationWorker(pool) });
    results.push({ worker: "bubbleSummarySync", result: await bubbleSummarySync() });
    results.push({ worker: "heartbeatWorker", result: await heartbeatWorker(pool) });

    res.status(200).json({ ok: true, message: "All workers completed successfully", results });
  } catch (err: any) {
    console.error("[workers] Error running workers:", err);
    res.status(500).json({ ok: false, error: err.message, results });
  }
});

/* ----------------------- Backfill Historical Data ---------------------- */
app.get("/workers/backfill-summaries", async (_req, res) => {
  console.log("[workers] Backfilling ALL historical summary data...");
  try {
    const result = await runSummaryWorker(pool, { fullHistory: true });
    res.status(200).json({
      ok: true,
      message: "Historical data backfill completed",
      result,
      note: "All summaries_daily records have been updated with mode breakdown data"
    });
  } catch (err: any) {
    console.error("[workers] Error backfilling summaries:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
/* ----------------------- Diagnostic: Check Mode Data ---------------------- */
app.get("/diagnostic/mode-data/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  console.log("[diagnostic] Checking mode data for device:", deviceId);
  
  try {
    // Get mode breakdown from runtime_sessions
    const result = await pool.query(`
      SELECT 
        rs.mode,
        COUNT(*) as session_count,
        SUM(rs.runtime_seconds) as total_seconds
      FROM runtime_sessions rs
      JOIN devices d ON d.device_key = rs.device_key
      WHERE d.device_id = $1
      GROUP BY rs.mode
      ORDER BY total_seconds DESC
    `, [deviceId]);
    
    res.json({
      ok: true,
      device_id: deviceId,
      mode_breakdown: result.rows
    });
  } catch (err: any) {
    console.error("[diagnostic] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
/* --------------------------- Global Error Trap -------------------------- */
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("💥 Uncaught server error:", err);
  res.status(500).json({ ok: false, error: err.message });
});

/* --------------------------- Start Server ------------------------------ */
app.listen(PORT, () => {
  console.log(`🚀 SmartFilterPro Core Ingest running securely on port ${PORT}`);
  if (!process.env.CORE_API_KEY)
    console.warn("⚠️ CORE_API_KEY not set — external posts will fail auth!");

  startCronJobs();
});
