-- ============================================================
--  Migration: 019_fix_all_primary_keys.sql
--  Purpose: Batch repair all primary keys across
--           SmartFilterPro Core Ingest schema.
--  This script:
--    ✅ Detects and drops existing PKs if needed
--    ✅ Recreates them on the correct column(s)
--    ✅ Safe for repeated Railway runs (idempotent)
-- ============================================================

DO $$
DECLARE
    rec RECORD;
    pk_column TEXT;
    constraint_name TEXT;
    sql TEXT;

    -- Define mapping of tables → expected PK columns
    tables_pk_mapping CONSTANT JSONB := '{
        "devices": "device_key",
        "device_status": "device_key",
        "equipment_events": "event_id",
        "runtime_sessions": "session_id",
        "summaries_daily": "summary_id",
        "filter_resets": "reset_id",
        "region_averages": "region_prefix",
        "device_stats": "id",
        "device_states": "device_key"
    }'::jsonb;

BEGIN
    RAISE NOTICE '🔧 Starting batch primary key repair...';

    -- Loop through each table mapping
    FOR rec IN SELECT * FROM jsonb_each_text(tables_pk_mapping)
    LOOP
        pk_column := rec.value;
        RAISE NOTICE 'Processing table: % (PK column: %)', rec.key, pk_column;

        -- 1️⃣ Find existing primary key constraint name
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = rec.key::regclass
          AND contype = 'p';

        -- 2️⃣ Drop existing PK if it exists
        IF constraint_name IS NOT NULL THEN
            RAISE NOTICE 'Dropping existing PK: %', constraint_name;
            sql := FORMAT('ALTER TABLE public.%I DROP CONSTRAINT %I;', rec.key, constraint_name);
            EXECUTE sql;
        END IF;

        -- 3️⃣ Add the correct PK
        RAISE NOTICE 'Adding new PK: %_pkey on column: %', rec.key, pk_column;
        sql := FORMAT('ALTER TABLE public.%I ADD CONSTRAINT %I_pkey PRIMARY KEY (%I);',
                      rec.key, rec.key, pk_column);
        EXECUTE sql;

        RAISE NOTICE '✅ % primary key verified.', rec.key;
    END LOOP;

    RAISE NOTICE '🎯 Batch PK repair complete for all core tables.';
END $$;
