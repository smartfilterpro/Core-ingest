import express from "express";
import dotenv from "dotenv";
import { pool } from "./db/pool";
import ingestRoute from "./routes/ingest";
import healthRoute from "./routes/health";
import filterResetRoute from "./routes/filterReset";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Routes
app.use("/ingest", ingestRoute);
app.use("/health", healthRoute);
app.use("/filter-reset", filterResetRoute);

// Start
app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err: any) {
    console.error("⚠️ Database connection failed:", err.message);
  }

  console.log(`🚀 SmartFilterPro Core Ingest running on port ${PORT}`);
});
