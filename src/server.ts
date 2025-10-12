import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { pool } from "./db/pool";

// Routes
import ingestRouter from "./routes/ingest";
import ingestV2Router from "./routes/ingestV2";
import healthRouter from "./routes/health";
import filterResetRouter from "./routes/filterReset";
import usersRouter from "./routes/users";
import { workerLogsRouter } from "./routes/workerLogs";
import { deviceStatusRouter } from "./routes/deviceStatus";
import adminSchemaRouter from "./routes/adminSchema";

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
});