import express from 'express';
import { bubbleSummarySync } from '../workers/bubbleSummarySync';

const router = express.Router();

router.post('/', async (_req, res) => {
  try {
    const result = await bubbleSummarySync();
    res.json({ ok: true, result });
  } catch (err: any) {
    console.error('[bubbleSummarySync]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
