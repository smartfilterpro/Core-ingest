import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { pool } from "./db/pool";
import { ensureSchema } from "./db/ensureSchema";
import ingestRouter from "./routes/ingest";
import ingestV2Router from "./routes/ingestV2";
import {
  runSessionStitcher,
  runSummaryWorker,
  runRegionAggregationWorker,
  runAIWorker,
} from "./workers"; // optional central export

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// ✅ Health check
app.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.status(200).json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    console.error("[server] Health check error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Mount routers
app.use("/ingest", ingestRouter);
app.use("/ingest", ingestV2Router);

// ✅ Worker endpoints
app.get("/workers/run-all", async (_req, res) => {
  console.log("[workers] Running all workers sequentially...");
  const results: any[] = [];
  try {
    results.push({ worker: "sessionStitcher", result: await runSessionStitcher() });
    results.push({ worker: "summaryWorker", result: await runSummaryWorker(pool) });
    results.push({
      worker: "regionAggregationWorker",
      result: await runRegionAggregationWorker(pool),
    });
    results.push({ worker: "aiWorker", result: await runAIWorker(pool) });
    res.status(200).json({ ok: true, results });
  } catch (err: any) {
    console.error("[workers/run-all] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/workers/session-stitcher", async (_req, res) => {
  const result = await runSessionStitcher();
  res.status(result.ok ? 200 : 500).json(result);
});

app.get("/workers/summary", async (_req, res) => {
  const result = await runSummaryWorker(pool);
  res.status(200).json({ ok: true, result });
});

app.get("/workers/region", async (_req, res) => {
  const result = await runRegionAggregationWorker(pool);
  res.status(200).json({ ok: true, result });
});

app.get("/workers/ai", async (_req, res) => {
  const result = await runAIWorker(pool);
  res.status(200).json({ ok: true, result });
});

// ✅ Initialize schema and start server
(async () => {
  try {
    await ensureSchema(pool);
    console.log("✅ Database schema verified.");
  } catch (err: any) {
    console.error("❌ Error ensuring schema:", err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 SmartFilterPro Core Ingest Service running on port ${PORT}`);
  });
})();
