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
import { runWorker } from "./utils/runWorker";
import {
  runSessionStitcher,
  runSummaryWorker,
  runRegionAggregationWorker,
  bubbleSummarySync,
  heartbeatWorker,
} from "./workers/index";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

// =====================
// Register API routes
// =====================
app.use("/ingest", ingestRouter);
app.use("/ingest", ingestV2Router);
app.use("/health", healthRouter);
app.use("/filter-reset", filterResetRouter);
app.use("/users", usersRouter);
app.use("/workers/logs", workerLogsRouter);
app.use("/device-status", deviceStatusRouter);
app.use("/admin/schema", adminSchemaRouter);

// =====================
// Manual trigger route
// =====================
app.get("/workers/run-all", async (_req, res) => {
  console.log("[workers] Running all core workers sequentially...");
  const results: any[] = [];
  try {
    // 1️⃣ Session stitcher (no pool)
    results.push({ worker: "sessionStitcher", result: await runSessionStitcher() });

    // 2️⃣ Summary worker (needs pool)
    results.push({ worker: "summaryWorker", result: await runSummaryWorker(pool) });

    // 3️⃣ Region aggregation (needs pool)
    results.push({ worker: "regionAggregationWorker", result: await runRegionAggregationWorker(pool) });

    // 4️⃣ Bubble summary sync (no pool)
    results.push({ worker: "bubbleSummarySync", result: await bubbleSummarySync() });

    // 5️⃣ Heartbeat (needs pool)
    results.push({ worker: "heartbeatWorker", result: await heartbeatWorker(pool) });

    res.status(200).json({ o
