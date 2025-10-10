import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { pool } from "./db/pool";
import ingestRouter from "./routes/ingest";
import ingestV2Router from "./routes/ingestV2";
import healthRouter from "./routes/health";
import filterResetRouter from "./routes/filterReset";
import usersRouter from "./routes/users";
import { workerLogsRouter } from "./routes/workerLogs";
import { deviceStatusRouter } from "./routes/deviceStatus";
import { runWorker } from "./utils/runWorker";
import {
  runSessionStitcher,
  runSummaryWorker,
  runRegionAggregationWorker,
  bubbleSummarySync,
  heartbeatWorker,
} from "./workers/index";
import adminSchemaRouter from "./routes/adminSchema"; // if present

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

// Routes
app.use("/ingest", ingestRouter);
app.use("/ingest", ingestV2Router);
app.use("/health", healthRouter);
app.use("/filter-reset", filterResetRouter);
app.use("/users", usersRouter);
app.use("/workers/logs", workerLogsRouter);
app.use("/device-status", deviceStatusRouter);
app.use("/admin/schema", adminSchemaRouter);

app.get("/workers/run-all", async (_req, res) => {
  console.log("[workers] Running all core workers sequentially...");
  const results: any[] = [];
  try {
    results.push({ worker: "sessionStitcher", result: await runSessionStitcher() }); // no pool
    results.push({ worker: "summaryWorker", result: await runSummaryWorker(pool) });
    results.push({ worker: "regionAggregationWorker", result: await runRegionAggregationWorker(pool) });
    results.push({ worker: "bubbleSummarySync", result: await bubbleSummarySync(pool) });
    results.push({ worker: "heartbeatWorker", result: await heartbeatWorker(pool) });

    res.status(200).json({ ok: true, results });
  } catch (err: any) {
    console.error("[workers] run-all failed:", err);
    res.status(500).json({ ok: false, error: err.message, results });
  }
});


(async () => {
  try {
    const { runMigrations } = await import("./runMigrations");
    await runMigrations();
    console.log("[OK] Database migrations completed");
  } catch (err: any) {
    console.error("[ERROR] Migration failed:", err.message);
    console.log("[WARNING] Starting server anyway...");
  }

  app.listen(PORT, () => {
    console.log(`[OK] SmartFilterPro Core Ingest Service running on port ${PORT}`);
    console.log(`[OK] Database connected to Postgres`);
  });

 // ======================================================
  //  Background Worker Scheduler (starts after app.listen)
  // ======================================================

  const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_MIN = 60 * 1000;

setInterval(async () => {
  console.log("[scheduler] Running full worker cycle...");
  try {
    await runSessionStitcher();
    await runSummaryWorker(pool);
    await runRegionAggregationWorker(pool);
    await bubbleSummarySync(pool);
    await heartbeatWorker(pool);
    console.log("[scheduler] ✅ Completed full worker cycle.");
  } catch (e) {
    console.error("[scheduler] ❌ Error:", (e as Error).message);
  }
}, FIFTEEN_MIN);

setInterval(async () => {
  console.log("[scheduler] Running full worker cycle...");
  try {
    await runSessionStitcher(); // no pool
    await runSummaryWorker(pool);
    await runRegionAggregationWorker(pool);
    await bubbleSummarySync(pool);
    await heartbeatWorker(pool);
    console.log("[scheduler] ✅ Completed full worker cycle.");
  } catch (e) {
    console.error("[scheduler] ❌ Error:", (e as Error).message);
  }
}, FIFTEEN_MIN);
})();
