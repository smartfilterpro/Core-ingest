import { Pool } from 'pg';

/**
 * Runtime Validation Worker
 *
 * Compares Ecobee's ground-truth runtime data (from Runtime Reports)
 * with our calculated runtime (from sessionStitcher + summaryWorker).
 *
 * Updates summaries_daily with validated values. When discrepancies exceed
 * 5 minutes (300 seconds), automatically corrects the runtime values with
 * Ecobee's ground-truth data.
 *
 * Schedule: Daily at 04:00 UTC (runs after summaryWorker at 03:00 UTC)
 */
export async function runRuntimeValidator(
  pool: Pool,
  options?: { days?: number }
) {
  const days = options?.days || 1; // Default: validate yesterday
  console.log(
    `\n🔍 [RuntimeValidator] Starting validation for last ${days} day(s)...`
  );
  const startTime = Date.now();

  try {
    const query = `
      WITH ecobee_daily_totals AS (
        -- Aggregate Ecobee's ground truth from 5-minute intervals
        SELECT
          device_key,
          report_date,
          SUM(aux_heat1_seconds + aux_heat2_seconds + aux_heat3_seconds) as validated_auxheat,
          SUM(comp_cool1_seconds + comp_cool2_seconds) as validated_cooling,
          SUM(comp_heat1_seconds + comp_heat2_seconds) as validated_heating,
          SUM(fan_seconds) as validated_fan,
          COUNT(*) as interval_count,
          (COUNT(*) * 100.0 / 288) as coverage_percent
        FROM ecobee_runtime_intervals
        WHERE report_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY device_key, report_date
      ),
      calculated_totals AS (
        -- Get our calculated runtime from summaries_daily
        SELECT
          d.device_key,
          s.date,
          s.runtime_seconds_heat as calculated_heating,
          s.runtime_seconds_cool as calculated_cooling,
          s.runtime_seconds_auxheat as calculated_auxheat,
          s.runtime_seconds_fan as calculated_fan,
          s.runtime_seconds_total as calculated_total
        FROM summaries_daily s
        INNER JOIN devices d ON d.device_id = s.device_id
        WHERE s.date >= CURRENT_DATE - INTERVAL '${days} days'
      )
      UPDATE summaries_daily s
      SET
        -- Store validated values
        validated_runtime_seconds_heat = edt.validated_heating,
        validated_runtime_seconds_cool = edt.validated_cooling,
        validated_runtime_seconds_auxheat = edt.validated_auxheat,
        validated_runtime_seconds_fan = edt.validated_fan,
        validated_runtime_seconds_total = edt.validated_heating + edt.validated_cooling + edt.validated_auxheat,

        -- Validation metadata
        validation_source = 'ecobee_runtime_report',
        validation_interval_count = edt.interval_count,
        validation_coverage_percent = edt.coverage_percent,
        validation_discrepancy_seconds = ABS(
          (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
          COALESCE(ct.calculated_total, 0)
        ),
        validation_performed_at = NOW(),

        -- Flag significant discrepancies (>5 minutes)
        is_corrected = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN TRUE
          ELSE FALSE
        END,
        corrected_at = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN NOW()
          ELSE NULL
        END,

        -- Auto-correct runtime values when discrepancy > 5 minutes
        runtime_seconds_heat = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN edt.validated_heating
          ELSE s.runtime_seconds_heat
        END,
        runtime_seconds_cool = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN edt.validated_cooling
          ELSE s.runtime_seconds_cool
        END,
        runtime_seconds_auxheat = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN edt.validated_auxheat
          ELSE s.runtime_seconds_auxheat
        END,
        runtime_seconds_fan = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN edt.validated_fan
          ELSE s.runtime_seconds_fan
        END,
        runtime_seconds_total = CASE
          WHEN ABS(
            (edt.validated_heating + edt.validated_cooling + edt.validated_auxheat) -
            COALESCE(ct.calculated_total, 0)
          ) > 300 THEN edt.validated_heating + edt.validated_cooling + edt.validated_auxheat
          ELSE s.runtime_seconds_total
        END
      FROM ecobee_daily_totals edt
      INNER JOIN devices d ON d.device_key = edt.device_key
      LEFT JOIN calculated_totals ct ON ct.device_key = edt.device_key AND ct.date = edt.report_date
      WHERE s.device_id = d.device_id AND s.date = edt.report_date
      RETURNING s.device_id, s.date, s.validation_discrepancy_seconds
    `;

    const result = await pool.query(query);
    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(
      `[RuntimeValidator] ✅ Validated ${result.rowCount} daily summaries in ${duration}s`
    );

    // Log significant discrepancies
    const { rows: discrepancies } = await pool.query(`
      SELECT
        device_id,
        date,
        runtime_seconds_total as calculated,
        validated_runtime_seconds_total as validated,
        validation_discrepancy_seconds as discrepancy,
        validation_coverage_percent as coverage
      FROM summaries_daily
      WHERE validation_discrepancy_seconds > 300
        AND validation_performed_at >= NOW() - INTERVAL '1 hour'
      ORDER BY validation_discrepancy_seconds DESC
      LIMIT 20
    `);

    if (discrepancies.length > 0) {
      console.warn(
        `[RuntimeValidator] 🔧 Auto-corrected ${discrepancies.length} ` +
        `summaries with significant discrepancies (>5 min):`
      );
      discrepancies.forEach(r => {
        const discrepMin = Math.round(r.discrepancy / 60);
        console.warn(
          `  ${r.device_id} on ${r.date}: ` +
          `was=${r.calculated}s, corrected to=${r.validated}s, ` +
          `discrepancy=${discrepMin}min, coverage=${r.coverage?.toFixed(1)}%`
        );
      });
    } else {
      console.log(
        `[RuntimeValidator] ✅ No corrections needed (all within 5 min tolerance)`
      );
    }

    // Summary stats
    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*) as total_validated,
        COUNT(*) FILTER (WHERE is_corrected = TRUE) as corrected_count,
        AVG(validation_coverage_percent) as avg_coverage,
        AVG(validation_discrepancy_seconds) as avg_discrepancy
      FROM summaries_daily
      WHERE validation_performed_at >= NOW() - INTERVAL '1 hour'
    `);

    if (stats[0]) {
      console.log(`[RuntimeValidator] 📊 Stats:`);
      console.log(`  Total validated: ${stats[0].total_validated}`);
      console.log(`  Auto-corrected: ${stats[0].corrected_count}`);
      console.log(`  Avg coverage: ${stats[0].avg_coverage?.toFixed(1)}%`);
      console.log(
        `  Avg discrepancy: ${Math.round(stats[0].avg_discrepancy || 0)}s`
      );
    }

    return {
      validated: result.rowCount,
      discrepancies: discrepancies.length,
      stats: stats[0]
    };

  } catch (err: any) {
    console.error('[RuntimeValidator] ❌ Error:', err.message);
    throw err;
  }
}
