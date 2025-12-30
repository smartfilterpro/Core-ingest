import { Pool } from 'pg';

const USER_METRICS_LOOKBACK_DAYS = parseInt(process.env.USER_METRICS_LOOKBACK_DAYS || '7');

/**
 * Aggregates daily user metrics including:
 * - Users added per day (first device creation date for each user)
 * - Users deleted per day (from user_deletions table)
 * - Total users, devices, and active users snapshot
 */
export async function runUserMetricsWorker(pool: Pool) {
  console.log('📊 Starting User Metrics Worker...');

  try {
    // Upsert daily metrics for the lookback period
    const query = `
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${USER_METRICS_LOOKBACK_DAYS} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      ),
      -- Count new users per day (users whose first device was created on that date)
      new_users AS (
        SELECT
          DATE(MIN(created_at)) as join_date,
          COUNT(DISTINCT user_id) as new_user_count
        FROM devices
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      ),
      new_users_by_date AS (
        SELECT
          join_date as date,
          SUM(new_user_count) as users_added
        FROM new_users
        WHERE join_date >= CURRENT_DATE - INTERVAL '${USER_METRICS_LOOKBACK_DAYS} days'
        GROUP BY join_date
      ),
      -- Count deleted users per day
      deleted_users_by_date AS (
        SELECT
          deleted_date as date,
          COUNT(*) as users_deleted
        FROM user_deletions
        WHERE deleted_date >= CURRENT_DATE - INTERVAL '${USER_METRICS_LOOKBACK_DAYS} days'
        GROUP BY deleted_date
      ),
      -- Get current totals for snapshot
      current_totals AS (
        SELECT
          COUNT(DISTINCT user_id) as total_users,
          COUNT(*) as total_devices
        FROM devices
        WHERE user_id IS NOT NULL
      ),
      -- Count active users in last 24h (users with device activity)
      active_users AS (
        SELECT COUNT(DISTINCT d.user_id) as active_users_24h
        FROM devices d
        JOIN device_status ds ON ds.device_key = d.device_key
        WHERE ds.last_seen_at >= NOW() - INTERVAL '24 hours'
          AND d.user_id IS NOT NULL
      ),
      -- Combine into daily metrics
      daily_metrics AS (
        SELECT
          ds.date,
          COALESCE(nu.users_added, 0) as users_added,
          COALESCE(du.users_deleted, 0) as users_deleted,
          ct.total_users,
          ct.total_devices,
          au.active_users_24h
        FROM date_series ds
        LEFT JOIN new_users_by_date nu ON nu.date = ds.date
        LEFT JOIN deleted_users_by_date du ON du.date = ds.date
        CROSS JOIN current_totals ct
        CROSS JOIN active_users au
      )
      INSERT INTO user_metrics_daily (
        date,
        users_added,
        users_deleted,
        total_users,
        total_devices,
        active_users_24h,
        updated_at
      )
      SELECT
        dm.date,
        dm.users_added,
        dm.users_deleted,
        dm.total_users,
        dm.total_devices,
        dm.active_users_24h,
        NOW()
      FROM daily_metrics dm
      ON CONFLICT (date)
      DO UPDATE SET
        users_added = EXCLUDED.users_added,
        users_deleted = EXCLUDED.users_deleted,
        total_users = EXCLUDED.total_users,
        total_devices = EXCLUDED.total_devices,
        active_users_24h = EXCLUDED.active_users_24h,
        updated_at = NOW()
      RETURNING *;
    `;

    const { rows } = await pool.query(query);
    console.log(`✅ User Metrics Worker: ${rows.length} daily metrics created/updated.`);

    // Log summary
    const today = rows.find(r => r.date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]);
    if (today) {
      console.log(`📊 Today's metrics: +${today.users_added} users, -${today.users_deleted} users (net: ${today.net_user_change})`);
      console.log(`📊 Totals: ${today.total_users} users, ${today.total_devices} devices, ${today.active_users_24h} active (24h)`);
    }

    console.log('📊 User Metrics Worker done.');

    return {
      ok: true,
      success: true,
      days_updated: rows.length,
      lookback_days: USER_METRICS_LOOKBACK_DAYS,
      latest: today ? {
        date: today.date,
        users_added: today.users_added,
        users_deleted: today.users_deleted,
        net_change: today.net_user_change,
        total_users: today.total_users,
        total_devices: today.total_devices,
        active_users_24h: today.active_users_24h
      } : null
    };
  } catch (err: any) {
    console.error('[UserMetricsWorker] Error:', err.message);
    return {
      ok: false,
      success: false,
      error: err.message
    };
  }
}

/**
 * Backfill historical user metrics from device creation dates
 * Useful for populating data before the worker was implemented
 */
export async function backfillUserMetrics(pool: Pool, days: number = 365) {
  console.log(`📊 Backfilling User Metrics for last ${days} days...`);

  try {
    const query = `
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${days} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      ),
      -- Count new users per day based on their first device creation
      new_users AS (
        SELECT
          user_id,
          DATE(MIN(created_at)) as join_date
        FROM devices
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      ),
      new_users_by_date AS (
        SELECT
          join_date as date,
          COUNT(*) as users_added
        FROM new_users
        GROUP BY join_date
      ),
      -- Count deleted users per day (only from when tracking started)
      deleted_users_by_date AS (
        SELECT
          deleted_date as date,
          COUNT(*) as users_deleted
        FROM user_deletions
        GROUP BY deleted_date
      ),
      -- Calculate running totals for each day
      -- This is an approximation - actual totals at each point in time
      running_totals AS (
        SELECT
          ds.date,
          COALESCE(nu.users_added, 0) as users_added,
          COALESCE(du.users_deleted, 0) as users_deleted,
          -- Running total of users (added - deleted up to this date)
          SUM(COALESCE(nu.users_added, 0) - COALESCE(du.users_deleted, 0))
            OVER (ORDER BY ds.date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as estimated_total_users
        FROM date_series ds
        LEFT JOIN new_users_by_date nu ON nu.date = ds.date
        LEFT JOIN deleted_users_by_date du ON du.date = ds.date
      ),
      -- Get current totals for reference
      current_totals AS (
        SELECT
          COUNT(DISTINCT user_id) as total_users,
          COUNT(*) as total_devices
        FROM devices
        WHERE user_id IS NOT NULL
      )
      INSERT INTO user_metrics_daily (
        date,
        users_added,
        users_deleted,
        total_users,
        total_devices,
        active_users_24h,
        updated_at
      )
      SELECT
        rt.date,
        rt.users_added,
        rt.users_deleted,
        -- For historical data, use estimated running total
        GREATEST(0, rt.estimated_total_users) as total_users,
        -- We can't know historical device counts accurately, use current as placeholder
        ct.total_devices,
        -- Historical active users unknown, use 0
        0 as active_users_24h,
        NOW()
      FROM running_totals rt
      CROSS JOIN current_totals ct
      ON CONFLICT (date)
      DO UPDATE SET
        users_added = EXCLUDED.users_added,
        users_deleted = EXCLUDED.users_deleted,
        updated_at = NOW()
      RETURNING *;
    `;

    const { rows } = await pool.query(query);
    console.log(`✅ User Metrics Backfill: ${rows.length} days populated.`);

    return {
      ok: true,
      success: true,
      days_backfilled: rows.length
    };
  } catch (err: any) {
    console.error('[UserMetricsBackfill] Error:', err.message);
    return {
      ok: false,
      success: false,
      error: err.message
    };
  }
}
