import express, { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { v4 as uuidv4 } from "uuid";

export const ingestRouter = express.Router();

/* -------------------------------------------------------------------------- */
/*                               Auth Middleware                              */
/* -------------------------------------------------------------------------- */

function verifyCoreAuth(req: Request, res: Response, next: NextFunction) {
  const serverKey = process.env.CORE_API_KEY;
  const authHeader = req.headers["authorization"];

  if (!serverKey) {
    console.error("[CoreIngest] ❌ CORE_API_KEY missing on server!");
    return res
      .status(500)
      .json({ ok: false, error: "Server misconfigured (no CORE_API_KEY)" });
  }

  if (!authHeader || authHeader !== `Bearer ${serverKey}`) {
    console.warn(
      `[CoreIngest] 🚫 Unauthorized ingest attempt from ${req.ip || "unknown"}`
    );
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  next();
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
          `   ↳ ${e.source || "unknown"} | ${device_id} | ${event_type} | status=${equipment_status} | runtime=${runtime_seconds ?? "—"} | temp=${temperature_f}F (${temperature_c?.toFixed(
            2
          )}C) | humidity=${humidity ?? "—"}`
        );

        /* --------------------------- devices --------------------------- */
        await client.query(
          `
          INSERT INTO devices (
            device_key, device_id, workspace_id, user_id,
            device_name, manufacturer, model, model_number, source, connection_source,
            device_type, firmware_version, serial_number, ip_address,
            frontend_id, zip_prefix, zip_code_prefix, timezone,
            filter_target_hours, filter_usage_percent, use_forced_air_for_heat,
            last_mode, last_is_cooling, last_is_heating, last_is_fan_only,
            last_equipment_status, is_reachable,
            last_temperature, last_humidity, last_heat_setpoint, last_cool_setpoint,
            source_event_id, created_at, updated_at
          )
          VALUES (
            $1,$2,$3,$4,
            $5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,
            $15,$16,$17,$18,
            $19,$20,$21,
            $22,$23,$24,$25,
            $26,$27,
            $28,$29,$30,$31,
            $32,NOW(),NOW()
          )
          ON CONFLICT (device_key) DO UPDATE
          SET
            device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
            manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
            model = COALESCE(EXCLUDED.model, devices.model),
            model_number = COALESCE(EXCLUDED.model_number, devices.model_number),
            source = COALESCE(EXCLUDED.source, devices.source),
            connection_source = COALESCE(EXCLUDED.connection_source, devices.connection_source),
            device_type = COALESCE(EXCLUDED.device_type, devices.device_type),
            firmware_version = COALESCE(EXCLUDED.firmware_version, devices.firmware_version),
            serial_number = COALESCE(EXCLUDED.serial_number, devices.serial_number),
            ip_address = COALESCE(EXCLUDED.ip_address, devices.ip_address),
            is_reachable = COALESCE(EXCLUDED.is_reachable, devices.is_reachable),
            last_mode = COALESCE(EXCLUDED.last_mode, devices.last_mode),
            last_equipment_status = COALESCE(EXCLUDED.last_equipment_status, devices.last_equipment_status),
            last_temperature = COALESCE(EXCLUDED.last_temperature, devices.last_temperature),
            last_humidity = COALESCE(EXCLUDED.last_humidity, devices.last_humidity),
            last_heat_setpoint = COALESCE(EXCLUDED.last_heat_setpoint, devices.last_heat_setpoint),
            last_cool_setpoint = COALESCE(EXCLUDED.last_cool_setpoint, devices.last_cool_setpoint),
            updated_at = NOW()
          `,
          [
            device_key,
            device_id,
            workspace_id,
            e.user_id || null,
            e.device_name || null,
            e.manufacturer || "Unknown",
            e.model || null,
            model_number,
            e.source || "unknown",
            e.connection_source || e.source || "unknown",
            e.device_type || "thermostat",
            e.firmware_version || null,
            serial_number,
            e.ip_address || null,
            e.frontend_id || null,
            e.zip_prefix || null,
            e.zip_code_prefix || e.zip_prefix || null,
            e.timezone || null,
            e.filter_target_hours ?? 100,
            e.filter_usage_percent ?? 0,
            e.use_forced_air_for_heat ?? null,
            e.last_mode || null,
            e.last_is_cooling ?? null,
            e.last_is_heating ?? null,
            e.last_is_fan_only ?? null,
            e.last_equipment_status || e.equipment_status || null,
            e.is_reachable ?? true,
            e.last_temperature ?? e.temperature_f ?? null,
            humidity,
            e.last_heat_setpoint ?? null,
            e.last_cool_setpoint ?? null,
            e.source_event_id ?? null,
          ]
        );

        /* ------------------------- device_status ------------------------ */
        await client.query(
          `
          INSERT INTO device_status (
            device_key, device_name, manufacturer, source_vendor, connection_source,
            is_reachable, last_mode, current_equipment_status,
            last_temperature, current_temp_f, last_temperature_c,
            last_cool_setpoint, last_heat_setpoint, last_equipment_status,
            last_humidity, last_is_heating, last_is_cooling, last_is_fan_only,
            use_forced_air_for_heat, frontend_id, is_running,
            last_fan_timer_until, is_fan_timer_on, last_fan_mode,
            last_activity_at, last_seen_at, last_active, updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW()
          )
          ON CONFLICT (device_key) DO UPDATE
          SET
            device_name = COALESCE(EXCLUDED.device_name, device_status.device_name),
            manufacturer = COALESCE(EXCLUDED.manufacturer, device_status.manufacturer),
            last_humidity = COALESCE(EXCLUDED.last_humidity, device_status.last_humidity),
            current_equipment_status = COALESCE(EXCLUDED.current_equipment_status, device_status.current_equipment_status),
            last_temperature = COALESCE(EXCLUDED.last_temperature, device_status.last_temperature),
            last_cool_setpoint = COALESCE(EXCLUDED.last_cool_setpoint, device_status.last_cool_setpoint),
            last_heat_setpoint = COALESCE(EXCLUDED.last_heat_setpoint, device_status.last_heat_setpoint),
            updated_at = NOW()
          `,
          [
            device_key,
            e.device_name || null,
            e.manufacturer || "Unknown",
            e.source_vendor || e.source || "unknown",
            e.connection_source || e.source || "unknown",
            e.is_reachable ?? true,
            e.last_mode || "off",
            equipment_status,
            temperature_f,
            temperature_f,
            temperature_c,
            cool_setpoint,
            heat_setpoint,
            e.last_equipment_status || e.equipment_status || null,
            humidity,
            e.last_is_heating ?? null,
            e.last_is_cooling ?? null,
            e.last_is_fan_only ?? null,
            e.use_forced_air_for_heat ?? null,
            e.frontend_id || null,
            e.is_running ?? e.is_active ?? false,
            e.last_fan_timer_until ?? null,
            e.is_fan_timer_on ?? false,
            e.last_fan_mode || null,
            e.is_active ? event_time : null,
            e.is_reachable ? event_time : null,
            e.is_active ?? false,
          ]
        );

        /* ----------------------- equipment_events ----------------------- */
        try {
          await client.query(
            `
            INSERT INTO equipment_events (
              id, device_key, event_id, source_event_id,
              event_type, is_active, equipment_status, previous_status,
              last_temperature, last_temperature_c, last_humidity, humidity,
              last_heat_setpoint, last_cool_setpoint,
              hvac_status, fan_timer_mode, thermostat_mode,
              runtime_seconds,
              observed_at, recorded_at, event_timestamp,
              outdoor_temperature_f, outdoor_humidity, pressure_hpa,
              source_vendor, payload_raw, created_at
            )
            VALUES (
              $1,$2,$3,$4,
              $5,$6,$7,$8,
              $9,$10,$11,$12,
              $13,$14,
              $15,$16,$17,
              $18,
              $19,$20,$21,
              $22,$23,$24,
              $25,$26,NOW()
            )
            ON CONFLICT (device_key, event_type, equipment_status, recorded_at)
            DO NOTHING
            `,
            [
              uuidv4(),
              device_key,
              uuidv4(),
              source_event_id,
              event_type,
              e.is_active ?? false,
              equipment_status,
              e.previous_status || null,
              temperature_f,
              temperature_c,
              humidity,
              humidity,
              heat_setpoint,
              cool_setpoint,
              e.hvac_status || null,
              e.fan_timer_mode || null,
              e.thermostat_mode || null,
              runtime_seconds,
              event_time,
              new Date().toISOString(),
              e.event_timestamp || event_time,
              outdoor_temperature_f,
              outdoor_humidity,
              pressure_hpa,
              e.source_vendor || e.source || "unknown",
              JSON.stringify(e),
            ]
          );
        } catch (err: any) {
          if (err?.code === "23505") {
            console.warn("⚠️ duplicate skipped");
          } else {
            console.error("❌ [equipment_events] insert error:", err);
          }
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