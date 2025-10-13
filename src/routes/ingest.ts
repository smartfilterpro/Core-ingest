import express, { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { v4 as uuidv4 } from "uuid";
import { jwtVerify } from "jose";

export const ingestRouter = express.Router();

/* -------------------------------------------------------------------------- */
/*                               Auth Middleware                              */
/* -------------------------------------------------------------------------- */

async function verifyCoreAuth(req: Request, res: Response, next: NextFunction) {
  const coreApiKey = process.env.CORE_API_KEY;
  const secret = process.env.CORE_JWT_SECRET;
  const alg = process.env.CORE_JWT_ALG || "HS256";
  const iss = process.env.CORE_JWT_ISS || "bubble.smartfilterpro";
  const aud = process.env.CORE_JWT_AUD || "core.smartfilterpro";
  const requireAuth = (process.env.AUTH_REQUIRED || "true") === "true";

  if (!requireAuth) {
    console.warn("[Auth] ⚠️ AUTH_REQUIRED=false — skipping verification");
    return next();
  }

  // Accept either Bearer <token> or x-core-token
  const authHeader = req.headers["authorization"];
  const tokenHeader = req.headers["x-core-token"] as string | undefined;
  let token: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (tokenHeader) {
    token = tokenHeader.trim();
  }

  // 1️⃣ Legacy static key support (for Nest, Ecobee, Resideo)
  if (coreApiKey && token === coreApiKey) {
    console.log("[Auth] ✅ Authorized via static CORE_API_KEY");
    (req as any).auth = { method: "api_key" };
    return next();
  }

  // 2️⃣ JWT verification (Bubble-issued core_token)
  if (!token) {
    console.warn(`[Auth] 🚫 Missing Authorization from ${req.ip}`);
    return res.status(401).json({ ok: false, error: "Missing Authorization" });
  }

  if (!secret) {
    console.error("[Auth] ❌ CORE_JWT_SECRET not configured!");
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: [alg],
      issuer: iss,
      audience: aud,
    });
    console.log(
      `[Auth] ✅ Verified JWT: sub=${payload.sub}, iss=${payload.iss}, aud=${payload.aud}`
    );
    (req as any).auth = { method: "jwt", ...payload };
    next();
  } catch (err: any) {
    console.warn(`[Auth] ❌ JWT verification failed: ${err.message}`);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Utilities                                  */
/* -------------------------------------------------------------------------- */

function getHumidity(e: any): number | null {
  return (
    e.last_humidity ??
    e.humidity ??
    e.payload_raw?.humidity ??
    e.payload_raw?.currentHumidity ??
    e.payload_raw?.ambientHumidity ??
    null
  );
}

function getOutdoorTemperature(e: any): number | null {
  return (
    e.outdoor_temperature_f ??
    e.payload_raw?.outdoorTemperatureF ??
    e.payload_raw?.outdoorTempF ??
    null
  );
}

function getOutdoorHumidity(e: any): number | null {
  return (
    e.outdoor_humidity ??
    e.payload_raw?.outdoorHumidity ??
    e.payload_raw?.outdoorHumidityPercent ??
    null
  );
}

function getPressure(e: any): number | null {
  return e.pressure_hpa ?? e.payload_raw?.pressureHpa ?? null;
}

function getSerialNumber(e: any): string | null {
  return (
    e.serial_number ??
    e.payload_raw?.serialNumber ??
    e.payload_raw?.serial ??
    null
  );
}

function getModelNumber(e: any): string | null {
  return (
    e.model_number ??
    e.payload_raw?.modelNumber ??
    e.payload_raw?.model ??
    e.model ??
    null
  );
}

function getRuntimeSeconds(e: any): number | null {
  const raw = e.runtime_seconds ?? e.payload_raw?.runtimeSeconds ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.round(n));
}

/* -------------------------------------------------------------------------- */
/*                              Main Ingest Route                             */
/* -------------------------------------------------------------------------- */

ingestRouter.post(
  "/v1/events:batch",
  verifyCoreAuth,
  async (req: Request, res: Response) => {
    let raw = req.body;
    let events: any[] = [];

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item?.events && Array.isArray(item.events)) events.push(...item.events);
        else events.push(item);
      }
    } else if (raw?.events && Array.isArray(raw.events)) {
      events = raw.events;
    } else {
      events = [raw];
    }

    if (!events.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing events array or invalid payload" });
    }

    const client = await pool.connect();
    const inserted: string[] = [];

    console.log("\n📬 [ingest] Full incoming payload:");
    console.dir(req.body, { depth: null });
    console.log(`📥 [ingest] Normalized ${events.length} event(s)`);

    try {
      await client.query("BEGIN");

      for (const e of events) {
        const device_key = e.device_key || e.device_id || uuidv4();
        const device_id = e.device_id || e.device_key || null;
        const workspace_id = e.workspace_id || e.user_id || "unknown";
        const event_time: string =
          e.timestamp || e.recorded_at || new Date().toISOString();

        const temperature_f =
          e.temperature_f !== undefined
            ? parseFloat(e.temperature_f)
            : e.last_temperature !== undefined
            ? parseFloat(e.last_temperature)
            : null;

        let temperature_c: number | null = null;
        if (e.temperature_c !== undefined) {
          temperature_c = parseFloat(e.temperature_c);
        } else if (temperature_f !== null) {
          temperature_c = ((temperature_f - 32) * 5) / 9;
        }

        const humidity = getHumidity(e);
        const outdoor_temperature_f = getOutdoorTemperature(e);
        const outdoor_humidity = getOutdoorHumidity(e);
        const pressure_hpa = getPressure(e);
        const serial_number = getSerialNumber(e);
        const model_number = getModelNumber(e);

        const heat_setpoint = e.last_heat_setpoint ?? e.heat_setpoint_f ?? null;
        const cool_setpoint = e.last_cool_setpoint ?? e.cool_setpoint_f ?? null;
        const runtime_seconds = getRuntimeSeconds(e);
        const equipment_status = e.equipment_status || "OFF";
        const event_type = e.event_type || "UNKNOWN";

        const source_event_id: string =
          runtime_seconds && runtime_seconds > 0
            ? uuidv4()
            : e.source_event_id || uuidv4();

        console.log(
          `   ↳ ${e.source || "unknown"} | ${device_id} | ${event_type} | status=${equipment_status} | runtime=${runtime_seconds ?? "—"}`
        );

        /* --------------------------- devices --------------------------- */
        // ✅ KEEP your existing insert logic unchanged below this line
        await client.query(
          `...`, // your full insert block for devices
          [/* your params */]
        );

        /* ------------------------- device_status ------------------------ */
        await client.query(
          `...`, // your existing insert for device_status
          [/* params */]
        );

        /* ----------------------- equipment_events ----------------------- */
        try {
          await client.query(
            `...`, // your existing insert for equipment_events
            [/* params */]
          );
        } catch (err: any) {
          if (err?.code === "23505") console.warn("⚠️ duplicate skipped");
          else console.error("❌ [equipment_events] insert error:", err);
        }

        inserted.push(device_key);
      }

      await client.query("COMMIT");
      console.log(`📤 [ingest] ✅ Inserted ${inserted.length} event(s)\n`);
      return res.status(200).json({ ok: true, count: inserted.length });
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error("[ingest] ❌ Error processing batch:", err);
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

/* -------------------------------------------------------------------------- */
/*                                Health Check                                */
/* -------------------------------------------------------------------------- */
ingestRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default ingestRouter;
