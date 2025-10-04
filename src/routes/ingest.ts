import { Router } from "express";
import { pool } from "../db.js";
import { BatchIngestBody, TEventItem } from "../validators.js";
import { logger } from "../logger.js";

export const ingest = Router();

// Require API key for all ingest posts
function requireApiKey(req: any, res: any, next: any) {
  const key = req.headers["x-api-key"];
  if (!process.env.INGEST_API_KEY || key !== process.env.INGEST_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

ingest.post("/ingest/v1/events:batch", requireApiKey, async (req, res) => {
  const parse = BatchIngestBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid payload", details: parse.error.flatten() });
  }

  const { events } = parse.data;
  const client = await pool.connect();
  let inserted = 0;
  let duplicates = 0;

  try {
    await client.query("BEGIN");

    for (const e of events) {
      const result = await handleEvent(client, e);
      if (result === "duplicate") duplicates++;
      else if (result === "inserted") inserted++;
    }

    // Audit
    await client.query(
      `INSERT INTO ingest_audit (source, event_count, inserted_count, duplicates, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [events[0].source, events.length, inserted, duplicates, "batch_ingest"]
    );

    await client.query("COMMIT");
    res.json({ success: true, inserted, duplicates });
  } catch (err: any) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Batch ingest failed");
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

async function handleEvent(client: any, e: TEventItem): Promise<"inserted" | "duplicate"> {
  // --- 1. UPSERT device ---
  await client.query(
    `
    INSERT INTO devices (workspace_id, device_id, device_name, source, zip_code_prefix, timezone)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (device_id) DO UPDATE
      SET device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
          workspace_id = EXCLUDED.workspace_id,
          source = EXCLUDED.source,
          zip_code_prefix = COALESCE(EXCLUDED.zip_code_prefix, devices.zip_code_prefix),
          timezone = COALESCE(EXCLUDED.timezone, devices.timezone),
          updated_at = NOW();
  `,
    [e.workspaceId, e.deviceId, e.deviceName ?? null, e.source, e.zipCodePrefix ?? null, e.timezone ?? null]
  );

  // Fetch device_key
  const { rows } = await client.query(`SELECT device_key FROM devices WHERE device_id = $1`, [e.deviceId]);
  const deviceKey = rows[0]?.device_key;
  if (!deviceKey) throw new Error(`Device lookup failed for ${e.deviceId}`);

  // --- 2. Insert into equipment_events ---
  try {
    await client.query(
      `
      INSERT INTO equipment_events (
        device_key, source_event_id, event_type, equipment_status, previous_status, is_active,
        temperature_f, humidity, event_data, recorded_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (source_event_id) DO NOTHING
      `,
      [
        deviceKey,
        e.sourceEventId,
        e.eventType ?? "telemetry",
        e.equipmentStatus ?? null,
        e.previousStatus ?? null,
        e.isActive ?? null,
        e.temperatureF ?? null,
        e.humidity ?? null,
        e.eventData ?? {},
        e.timestamp
      ]
    );
  } catch (dup) {
    return "duplicate";
  }

  // --- 3. Insert into temp_readings if applicable ---
  if (e.temperatureF != null) {
    await client.query(
      `
      INSERT INTO temp_readings (
        device_key, temperature, humidity, setpoint_heat, setpoint_cool, outdoor_temperature,
        units, recorded_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [
        deviceKey,
        e.temperatureF,
        e.humidity ?? null,
        e.heatSetpointF ?? null,
        e.coolSetpointF ?? null,
        e.outdoorTempF ?? null,
        "F",
        e.timestamp
      ]
    );
  }

  // --- 4. Update device_status (non-null fields only) ---
  await client.query(
    `
    INSERT INTO device_status (device_key, current_mode, current_equipment_status, last_temperature,
                               indoor_humidity, last_heat_setpoint, last_cool_setpoint,
                               is_reachable, is_running, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (device_key) DO UPDATE SET
      current_mode = COALESCE(EXCLUDED.current_mode, device_status.current_mode),
      current_equipment_status = COALESCE(EXCLUDED.current_equipment_status, device_status.current_equipment_status),
      last_temperature = COALESCE(EXCLUDED.last_temperature, device_status.last_temperature),
      indoor_humidity = COALESCE(EXCLUDED.indoor_humidity, device_status.indoor_humidity),
      last_heat_setpoint = COALESCE(EXCLUDED.last_heat_setpoint, device_status.last_heat_setpoint),
      last_cool_setpoint = COALESCE(EXCLUDED.last_cool_setpoint, device_status.last_cool_setpoint),
      is_reachable = COALESCE(EXCLUDED.is_reachable, device_status.is_reachable),
      is_running = COALESCE(EXCLUDED.is_running, device_status.is_running),
      updated_at = NOW()
    `,
    [
      deviceKey,
      e.mode ?? null,
      e.equipmentStatus ?? null,
      e.temperatureF ?? null,
      e.humidity ?? null,
      e.heatSetpointF ?? null,
      e.coolSetpointF ?? null,
      e.isReachable ?? null,
      e.isActive ?? null
    ]
  );

  return "inserted";
}
