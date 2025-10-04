import { z } from "zod";

export const EventItem = z.object({
  // Required identifiers
  sourceEventId: z.string().min(1),
  source: z.string().min(1),
  workspaceId: z.string().min(1),
  deviceId: z.string().min(1),
  timestamp: z.string().datetime(),

  // Optional device metadata
  deviceName: z.string().nullable().optional(),
  macId: z.string().nullable().optional(),
  firmwareVersion: z.string().nullable().optional(),
  batteryLevel: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
  zipCodePrefix: z.string().nullable().optional(),
  roomDisplayName: z.string().nullable().optional(),

  // Mode and status
  mode: z.string().nullable().optional(),
  equipmentStatus: z.string().nullable().optional(),
  previousStatus: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  isFanRunning: z.boolean().nullable().optional(),
  isCooling: z.boolean().nullable().optional(),
  isHeating: z.boolean().nullable().optional(),
  isReachable: z.boolean().nullable().optional(),
  fanMode: z.string().nullable().optional(),
  lastFanTailUntil: z.string().datetime().nullable().optional(),

  // Environmental telemetry
  temperatureF: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  heatSetpointF: z.number().nullable().optional(),
  coolSetpointF: z.number().nullable().optional(),
  outdoorTempF: z.number().nullable().optional(),
  outdoorHumidity: z.number().nullable().optional(),

  // Context / linkage
  eventType: z.string().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  eventData: z.record(z.any()).nullable().optional()
});

export const BatchIngestBody = z.object({
  batchTs: z.string().datetime().optional(),
  events: z.array(EventItem).min(1)
});

export type TEventItem = z.infer<typeof EventItem>;
export type TBatchIngestBody = z.infer<typeof BatchIngestBody>;
