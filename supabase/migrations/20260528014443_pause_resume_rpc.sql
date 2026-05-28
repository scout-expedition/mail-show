-- Atomic pause / resume functions for the play-through game clock and
-- phase clock. Both columns are toggled in a single UPDATE so there is no
-- window where one is paused and the other is not.
--
-- Both functions are idempotent: pausing an already-paused playthrough is a
-- no-op; resuming one that is not paused is a no-op.

-- Helper RPC consumed by useServerClock: returns the current server epoch in
-- seconds as a float so the client can compute its local offset against
-- performance.now() once on mount and re-sync every 30 s.
create or replace function public.get_server_epoch_seconds()
  returns double precision
  language sql
  stable
  security definer
as $$
  select extract(epoch from now());
$$;

-- pause_playthrough(p_id)
-- Sets paused_at = now() on both the game clock and the phase clock.
-- No-op when paused_at is already non-null.
create or replace function public.pause_playthrough(p_id uuid)
  returns void
  language sql
  security definer
as $$
  update public.playthroughs
  set
    paused_at       = now(),
    phase_paused_at = now()
  where
    id = p_id
    and paused_at is null  -- idempotency guard: skip if already paused
    and started = true;
$$;

-- resume_playthrough(p_id)
-- Accumulates the elapsed pause duration into total_paused_ms and
-- phase_total_paused_ms, then clears both paused_at columns.
-- No-op when paused_at is null (not currently paused).
create or replace function public.resume_playthrough(p_id uuid)
  returns void
  language sql
  security definer
as $$
  update public.playthroughs
  set
    total_paused_ms       = total_paused_ms
                            + extract(epoch from (now() - paused_at)) * 1000,
    phase_total_paused_ms = phase_total_paused_ms
                            + extract(epoch from (now() - phase_paused_at)) * 1000,
    paused_at             = null,
    phase_paused_at       = null
  where
    id = p_id
    and paused_at is not null  -- idempotency guard: skip if not paused
    and started = true;
$$;