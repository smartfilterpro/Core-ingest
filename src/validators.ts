import { z } from "zod";

export const EventItem = z.object({
  // Required identifiers - use device_key consistently
  device_key: z.string().uuid(),
  source_event_id: z.string().optional(),
  source: z.string().min(1),
  workspace_id: z.string().min(1),
  timestamp: z.string().datetime(),

  // Optional device metadata
  device_name: z.string().nullable().optional(),
  device_id: z.string().nullable().optional(), // Vendor-specific ID
  mac_id: z.string().nullable().optional(),
  firmware_version: z.string().nullable().optional(),
  battery_level: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
  zip_code_prefix: z.string().nullable().optional(),
  room_display_name: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  connection_source: z.string().nullable().optional(),

  // Mode and status
  mode: z.string().nullable().optional(),
  equipment_status: z.string().nullable().optional(),
  previous_status: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  is_fan_running: z.boolean().nullable().optional(),
  is_cooling: z.boolean().nullable().optional(),
  is_heating: z.boolean().nullable().optional(),
  is_reachable: z.boolean().nullable().optional(),
  fan_mode: z.string().nullable().optional(),
  last_fan_tail_until: z.string().datetime().nullable().optional(),

  // Environmental telemetry
  temperature_f: z.number().nullable().optional(),
  temperature_c: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  heat_setpoint_f: z.number().nullable().optional(),
  cool_setpoint_f: z.number().nullable().optional(),
  outdoor_temp_f: z.number().nullable().optional(),
  outdoor_humidity: z.number().nullable().optional(),
  pressure_hpa: z.number().nullable().optional(),

  // Context / linkage
  event_type: z.string().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  runtime_seconds: z.number().int().nullable().optional(),
  event_data: z.record(z.any()).nullable().optional(),
  payload_raw: z.record(z.any()).nullable().optional()
});

export const BatchIngestBody = z.object({
  batch_ts: z.string().datetime().optional(),
  events: z.array(EventItem).min(1)
});

export type TEventItem = z.infer<typeof EventItem>;
export type TBatchIngestBody = z.infer<typeof BatchIngestBody>;
