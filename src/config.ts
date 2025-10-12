/**
 * SmartFilterPro Core Ingest — Centralized Configuration Loader
 * --------------------------------------------------------------
 * This file consolidates all environment variables used by the Core Ingest service.
 * It provides typed exports with sane defaults for local development and ensures
 * missing configuration values are surfaced early on startup.
 */

import dotenv from "dotenv";

// Load .env file in local development (Railway will already inject env vars)
dotenv.config();

export const cfg = {
  // 🔐 Security
  CORE_API_KEY: process.env.CORE_API_KEY || "",

  // 🌐 Core URLs
  CORE_INGEST_URL:
    process.env.CORE_INGEST_URL ||
    "https://core-ingest-yourenv.up.railway.app/ingest/v1/events:batch",

  // 🗄 Database
  DATABASE_URL: process.env.DATABASE_URL || "",

  // ⚙️ Retry & timing config
  CORE_POST_RETRIES: parseInt(process.env.CORE_POST_RETRIES || "3", 10),
  CORE_POST_RETRY_DELAY_MS: parseInt(
    process.env.CORE_POST_RETRY_DELAY_MS || "2000",
    10
  ),
  INGEST_MAX_RETRY_ATTEMPTS: parseInt(
    process.env.INGEST_MAX_RETRY_ATTEMPTS || "3",
    10
  ),
  INGEST_RETRY_DELAY_MS: parseInt(process.env.INGEST_RETRY_DELAY_MS || "2000", 10),

  // 🧠 Environment + misc
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "8080", 10),

  // 📦 Vendor / service metadata
  SERVICE_NAME: process.env.SERVICE_NAME || "core-ingest",
  SERVICE_SOURCE: process.env.SERVICE_SOURCE || "core",
};

/**
 * Quick validation — log a warning for missing critical vars.
 */
if (!cfg.CORE_API_KEY && cfg.NODE_ENV === "production") {
  console.warn("⚠️ CORE_API_KEY is missing — external ingest posts will fail auth!");
}
if (!cfg.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is missing — PostgreSQL connection will fail.");
}

export default cfg;