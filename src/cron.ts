// src/cron.ts
import cron from 'node-cron';
import { pool } from './db/pool';
import { runSessionStitcher } from './workers/sessionStitcher';
import { runSummaryWorker } from './workers/summaryWorker';
import { runRegionAggregationWorker } from './workers/regionAggregationWorker';
import { bubbleSummarySync } from './workers/bubbleSummarySync';
import { heartbeatWorker } from './workers/heartbeatWorker';

export function startCronJobs() {
  console.log('🕐 Starting cron jobs...');

  // Run Session Stitcher every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[CRON] Running Session Stitcher...');
    try {
      await runSessionStitcher();
      console.log('[CRON] ✅ Session Stitcher completed');
    } catch (err: any) {
      console.error('[CRON] ❌ Session Stitcher failed:', err.message);
    }
  });

  // Run Summary Worker every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('[CRON] Running Summary Worker...');
    try {
      await runSummaryWorker(pool);
      console.log('[CRON] ✅ Summary Worker completed');
    } catch (err: any) {
      console.error('[CRON] ❌ Summary Worker failed:', err.message);
    }
  });

  // Run Region Aggregation every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Running Region Aggregation...');
    try {
      await runRegionAggregationWorker(pool);
      console.log('[CRON] ✅ Region Aggregation completed');
    } catch (err: any) {
      console.error('[CRON] ❌ Region Aggregation failed:', err.message);
    }
  });

  // Run Bubble Sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[CRON] Running Bubble Sync...');
    try {
      await bubbleSummarySync();
      console.log('[CRON] ✅ Bubble Sync completed');
    } catch (err: any) {
      console.error('[CRON] ❌ Bubble Sync failed:', err.message);
    }
  });

  // Run Heartbeat Worker every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('[CRON] Running Heartbeat Worker...');
    try {
      await heartbeatWorker(pool);
      console.log('[CRON] ✅ Heartbeat Worker completed');
    } catch (err: any) {
      console.error('[CRON] ❌ Heartbeat Worker failed:', err.message);
    }
  });

  console.log('✅ All cron jobs scheduled');
}
