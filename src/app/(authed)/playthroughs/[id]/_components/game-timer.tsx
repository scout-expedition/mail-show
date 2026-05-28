"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Pause, Play } from "lucide-react";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useServerClock } from "@/lib/playthrough/use-server-clock";
import { gameElapsedMs } from "@/lib/playthrough/timer";
import { pauseGame, resumeGame } from "../_actions/play-actions";
import type { Playthrough } from "@/lib/db/types";

const TICK_MS = 500;

/** Format milliseconds as `HH:MM:SS`. */
function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Top-bar game timer.
 *
 * Displays the total game elapsed time (HH:MM:SS) and a pause/resume
 * button. When the local client is the last presence peer and another
 * peer leaves, it automatically calls `pauseGame` (best-effort auto-pause
 * on zero presence).
 */
export function GameTimer({ playthrough }: { playthrough: Playthrough }) {
  const nowMs = useServerClock();
  const [display, setDisplay] = useState(() =>
    formatMs(gameElapsedMs(playthrough, nowMs()))
  );
  const [pending, startTransition] = useTransition();

  // Tick the display every 500ms. Mirror props into a ref via
  // useLayoutEffect so the interval closure always reads the latest value
  // without re-registering the timer.
  const playthroughRef = useRef(playthrough);
  useLayoutEffect(() => {
    playthroughRef.current = playthrough;
  }, [playthrough]);

  useEffect(() => {
    function tick() {
      setDisplay(formatMs(gameElapsedMs(playthroughRef.current, nowMs())));
    }
    tick(); // immediate first render
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [nowMs]);

  const isPaused = playthrough.paused_at !== null;
  const isStarted = playthrough.started;

  // Auto-pause on zero presence: subscribe to presence-leave events.
  const { onPresenceLeave, peers } = usePresenceContext();
  const peersRef = useRef(peers);
  useLayoutEffect(() => {
    peersRef.current = peers;
  }, [peers]);
  const playthroughIdRef = useRef(playthrough.id);
  useLayoutEffect(() => {
    playthroughIdRef.current = playthrough.id;
  }, [playthrough.id]);

  const handlePresenceLeave = useCallback(() => {
    // Fire only when we're running and the post-leave peer list is empty.
    if (peersRef.current.length === 0 && !playthroughRef.current.paused_at) {
      startTransition(async () => {
        await pauseGame(playthroughIdRef.current);
      });
    }
  }, []);

  useEffect(() => {
    return onPresenceLeave(handlePresenceLeave);
  }, [onPresenceLeave, handlePresenceLeave]);

  if (!isStarted) return null;

  function onTogglePause() {
    startTransition(async () => {
      if (isPaused) {
        await resumeGame(playthrough.id);
      } else {
        await pauseGame(playthrough.id);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="font-mono text-sm tabular-nums text-foreground"
        aria-label="Game elapsed time"
      >
        {display}
      </span>
      <button
        type="button"
        onClick={onTogglePause}
        disabled={pending}
        aria-label={isPaused ? "Resume game timer" : "Pause game timer"}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        {isPaused ? (
          <Play size={13} aria-hidden />
        ) : (
          <Pause size={13} aria-hidden />
        )}
      </button>
    </div>
  );
}
