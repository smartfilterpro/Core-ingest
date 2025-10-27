import express, { Request, Response } from "express";
import { pool } from "../db/pool";
import { v4 as uuidv4 } from "uuid";

export const ingestV2Router = express.Router();

/**
 * POST /ingest/v2/events:batch
 * Accepts normalized device events from any vendor (Nest, Ecobee, Resideo, etc.)
 * Each event contains standard keys for consistency across ecosystems.
 */
ingestV2Router.post("/v2/events:batch", async (req: Request, res: Response) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const client = await pool.connect();
  const inserted: string[] = [];

  try {
    await client.query("BEGIN");

    for (const e of events) {
      if (!e.device_key) continue;

      const eventTimestamp =
        e.timestamp && !isNaN(Date.parse(e.timestamp))
          ? new Date(e.timestamp)
          : new Date();

      // ✅ Ensure the device exists or update its metadata
      await client.query(
        `
        INSERT INTO devices (
          device_key,
          name,
          manufacturer,
          user_id,
          connection_source,
          model
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (device_key) DO UPDATE
        SET
          name = COALESCE(EXCLUDED.name, devices.name),
          manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
          user_id = COALESCE(EXCLUDED.user_id, devices.user_id),
          connection_source = COALESCE(EXCLUDED.connection_source, devices.connection_source),
          model = COALESCE(EXCLUDED.model, devices.model),
          updated_at = NOW()
        `,
        [
          e.device_key,
          e.device_name ?? null,
          e.manufacturer ?? "unknown",
          e.user_id ?? null,
          e.connection_source ?? null,
          e.model ?? null,
        ]
      );

      // ✅ Update last-known state in devices
      await client.query(
        `
        UPDATE devices
        SET
          last_mode = COALESCE($2, last_mode),
          last_is_cooling = CASE WHEN $3 = 'COOLING' THEN TRUE ELSE FALSE END,
          last_is_heating = CASE WHEN $3 = 'HEATING' THEN TRUE ELSE FALSE END,
          last_is_fan_only = CASE WHEN $4 = TRUE THEN TRUE ELSE FALSE END,
          last_equipment_status = $3,
          last_temperature_f = $5,
          last_humidity = $6,
          updated_at = NOW()
        WHERE device_key = $1
        `,
        [
          e.device_key,
          e.event_type ?? null,
          e.equipment_status ?? "OFF",
          e.equipment_status === "FAN" || e.event_type?.includes("FAN"),
          e.temperature_f ?? null,
          e.humidity ?? null,
        ]
      );

      // ✅ Log event to equipment_events
      await client.query(
        `
        INSERT INTO equipment_events (
          id,
          device_key,
          event_type,
          is_active,
          equipment_status,
          temperature_f,
          temperature_c,
          humidity,
          runtime_seconds,
          current_temp,
          event_timestamp,
          source_vendor,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT DO NOTHING
        `,
        [
          uuidv4(),
          e.device_key,
          e.event_type ?? null,
          e.is_active ?? false,
          e.equipment_status ?? "OFF",
          e.temperature_f ?? null,
          e.temperature_c ?? null,
          e.humidity ?? null,
          e.runtime_seconds ?? null,
          e.current_temp ?? e.temperature_f ?? null,
          eventTimestamp,
          e.source_vendor ?? "unknown",
        ]
      );

      inserted.push(e.device_key);
    }

    await client.query("COMMIT");
    console.log(`[ingestV2] Inserted ${inserted.length} event(s).`);
    res.status(200).json({ ok: true, count: inserted.length });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[ingestV2] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/** PATCH /v2/update-device — from Bubble or integrations */
ingestV2Router.post("/v2/update-device", async (req, res) => {
  const { device_key, use_forced_air_for_heat, filter_target_hours } = req.body;
  if (!device_key)
    return res.status(400).json({ ok: false, error: "Missing device_key" });

  try {
    // Build dynamic UPDATE query based on provided fields
    const updates: string[] = [];
    const values: any[] = [device_key];
    let paramIndex = 2;

    if (use_forced_air_for_heat !== undefined) {
      updates.push(`use_forced_air_for_heat = $${paramIndex}`);
      values.push(use_forced_air_for_heat);
      paramIndex++;
    }

    if (filter_target_hours !== undefined) {
      updates.push(`filter_target_hours = $${paramIndex}`);
      values.push(filter_target_hours);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: "No fields to update" });
    }

    updates.push("updated_at = NOW()");

    await pool.query(
      `UPDATE devices SET ${updates.join(", ")} WHERE device_key = $1`,
      values
    );

    console.log(
      `[ingestV2] Updated device ${device_key}:`,
      use_forced_air_for_heat !== undefined ? `forcedAir=${use_forced_air_for_heat}` : "",
      filter_target_hours !== undefined ? `filterTarget=${filter_target_hours}h` : ""
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[ingestV2] update-device error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Health endpoint */
ingestV2Router.get("/v2/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.status(200).json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default ingestV2Router;
