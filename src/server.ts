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
app.use("/ingest", ingestRoute);
app.use("/health", healthRoute);
app.use("/filter-reset", filterResetRoute);

app.listen(PORT, () => {
  console.log(`✅ SmartFilterPro Core Ingest running on port ${PORT}`);
});
