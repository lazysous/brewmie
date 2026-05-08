-- get_algo_params()
-- Returns a single JSONB object containing algorithm parameters derived from
-- historical shot data in public_shots. Used by the Brewmie app to tune its
-- shot-time prediction model.
--
-- Run this file directly in the Supabase SQL Editor to create or replace the function.

CREATE OR REPLACE FUNCTION public.get_algo_params()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n            bigint;
  v_time_window  numeric;
  v_hum_hi       numeric;
  v_hum_lo       numeric;
  v_tmp_hi       numeric;
  v_tmp_lo       numeric;
  v_age_fresh    numeric;
  v_age_stale    numeric;

  -- Counts for the conditional-average guards (need >= 5 rows each)
  v_cnt_hum_hi   bigint;
  v_cnt_hum_lo   bigint;
  v_cnt_tmp_hi   bigint;
  v_cnt_tmp_lo   bigint;
  v_cnt_fresh    bigint;
  v_cnt_stale    bigint;

  -- Working variables for time_window
  v_tw_count     bigint;
  v_tw_stddev    numeric;
BEGIN
  -- -----------------------------------------------------------------------
  -- n: total qualifying rows (actual_time IS NOT NULL AND actual_time > 0)
  -- -----------------------------------------------------------------------
  SELECT COUNT(*)
    INTO v_n
    FROM public_shots
   WHERE actual_time IS NOT NULL
     AND actual_time > 0;

  -- -----------------------------------------------------------------------
  -- time_window: 1.5 × stddev(actual_time - target_time), clamped [3, 8].
  -- Requires both actual_time and target_time to be non-null.
  -- Falls back to 3 if fewer than 10 such rows exist.
  -- -----------------------------------------------------------------------
  SELECT COUNT(*),
         STDDEV(actual_time - target_time)
    INTO v_tw_count, v_tw_stddev
    FROM public_shots
   WHERE actual_time  IS NOT NULL
     AND actual_time  > 0
     AND target_time  IS NOT NULL;

  IF v_tw_count < 10 OR v_tw_stddev IS NULL THEN
    v_time_window := 3;
  ELSE
    -- ROUND(..., 1) gives one decimal place; GREATEST/LEAST clamp to [3, 8]
    v_time_window := GREATEST(3, LEAST(8, ROUND(1.5 * v_tw_stddev, 1)));
  END IF;

  -- -----------------------------------------------------------------------
  -- Conditional averages of (actual_time - target_time)
  -- Each returns NULL when the qualifying subset has fewer than 5 rows.
  -- Base filter for all: actual_time IS NOT NULL AND actual_time > 0.
  -- -----------------------------------------------------------------------

  -- hum_hi: humidity > 70
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_hum_hi, v_hum_hi
    FROM public_shots
   WHERE actual_time IS NOT NULL
     AND actual_time > 0
     AND target_time IS NOT NULL
     AND humidity > 70;

  IF v_cnt_hum_hi < 5 THEN v_hum_hi := NULL; END IF;

  -- hum_lo: humidity < 40
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_hum_lo, v_hum_lo
    FROM public_shots
   WHERE actual_time IS NOT NULL
     AND actual_time > 0
     AND target_time IS NOT NULL
     AND humidity < 40;

  IF v_cnt_hum_lo < 5 THEN v_hum_lo := NULL; END IF;

  -- tmp_hi: temp > 28
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_tmp_hi, v_tmp_hi
    FROM public_shots
   WHERE actual_time IS NOT NULL
     AND actual_time > 0
     AND target_time IS NOT NULL
     AND temp > 28;

  IF v_cnt_tmp_hi < 5 THEN v_tmp_hi := NULL; END IF;

  -- tmp_lo: temp < 15
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_tmp_lo, v_tmp_lo
    FROM public_shots
   WHERE actual_time IS NOT NULL
     AND actual_time > 0
     AND target_time IS NOT NULL
     AND temp < 15;

  IF v_cnt_tmp_lo < 5 THEN v_tmp_lo := NULL; END IF;

  -- age_fresh: bean_age_bucket = '0-7'
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_fresh, v_age_fresh
    FROM public_shots
   WHERE actual_time    IS NOT NULL
     AND actual_time    > 0
     AND target_time    IS NOT NULL
     AND bean_age_bucket = '0-7';

  IF v_cnt_fresh < 5 THEN v_age_fresh := NULL; END IF;

  -- age_stale: bean_age_bucket = '30+'
  SELECT COUNT(*), AVG(actual_time - target_time)
    INTO v_cnt_stale, v_age_stale
    FROM public_shots
   WHERE actual_time    IS NOT NULL
     AND actual_time    > 0
     AND target_time    IS NOT NULL
     AND bean_age_bucket = '30+';

  IF v_cnt_stale < 5 THEN v_age_stale := NULL; END IF;

  -- -----------------------------------------------------------------------
  -- Build and return the JSONB result
  -- -----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'n',           v_n,
    'time_window', v_time_window,
    'hum_hi',      v_hum_hi,
    'hum_lo',      v_hum_lo,
    'tmp_hi',      v_tmp_hi,
    'tmp_lo',      v_tmp_lo,
    'age_fresh',   v_age_fresh,
    'age_stale',   v_age_stale
  );
END;
$$;

-- Grant execute to both public roles used by the Supabase JS client
GRANT EXECUTE ON FUNCTION public.get_algo_params() TO anon;
GRANT EXECUTE ON FUNCTION public.get_algo_params() TO authenticated;
