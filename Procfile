web: node dist/server.js
web: npm install && npm run build && npm start
worker-session: node dist/workers/sessionSticher.js --loop
worker-summary-daily: node dist/workers/summaryWorker.js --run
worker-summary-hourly: node dist/workers/summaryWorker.js --hourly
