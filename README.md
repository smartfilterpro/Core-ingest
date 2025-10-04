# SmartFilterPro Core Ingest Service

This service receives normalized HVAC runtime events from vendor microservices (Ecobee, Nest, SmartThings, etc.), processes them into sessions, and generates runtime summaries for Bubble.io dashboards.

## Architecture
- **server.ts** → Express entrypoint for ingest routes
- **routes/ingest.ts** → `/ingest/v1/events:batch` handler
- **workers/sessionSticher.ts** → Builds runtime sessions
- **workers/summaryWorker.ts** → Aggregates daily & hourly summaries
- **db/migrations/** → Postgres schema files
- **utils/bubbleSync.ts** → Posts results back to Bubble.io

## Workers
| Worker | Description | Schedule |
|--------|--------------|----------|
| `sessionSticher` | Builds runtime_sessions from equipment_events | Continuous |
| `summaryWorker --run` | Aggregates daily summaries | Daily |
| `summaryWorker --hourly` | Aggregates hourly summaries | Hourly |

## Railway Deployment
- Add a `Procfile` (see repo)
- Set env vars in Railway dashboard (`DATABASE_URL`, `BUBBLE_SYNC_URL`, etc.)
- Add two triggers:
  - `worker-summary-daily`: `0 3 * * *`
  - `worker-summary-hourly`: `0 * * * *`

## Environment Variables
See `.env.example` for all required keys.

## Commands
```bash
npm run dev                      # Start API
npm run worker:session            # Run session stitcher manually
npm run worker:summary            # Run daily summary manually
npm run worker:summary:hourly     # Run hourly summary manually
npm run migrate                   # Apply DB migrations
