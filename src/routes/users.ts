import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

/**
 * DELETE /users/:userId
 * Deletes a user and all associated thermostats and data.
 */
router.delete('/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Missing userId' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE user_id = $1 RETURNING user_id',
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    console.log(`[deleteUser] Deleted user ${userId} and all linked thermostats.`);
    return res.status(200).json({ ok: true, message: `User ${userId} and all linked data deleted.` });
  } catch (err: any) {
    console.error('[deleteUser] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
