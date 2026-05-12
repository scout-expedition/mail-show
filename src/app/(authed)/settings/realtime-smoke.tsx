"use client";

import { useEffect, useState } from "react";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { FieldPresence } from "@/lib/realtime/field-presence";
import {
  usePresence,
  type PresenceFocus,
  type PresencePeer,
} from "@/lib/realtime/presence";
import { useInstantField } from "@/lib/realtime/use-instant-field";

/**
 * Throwaway smoke harness for the Phase 0 realtime primitives. Open this
 * page in two browser profiles signed in as different users and verify:
 *   1. Each tab's <AvatarStack> shows the OTHER user.
 *   2. Focusing a sandbox input in one tab makes the matching
 *      <FieldPresence> avatar appear next to that input in the other tab.
 *   3. Typing flips the inline status indicator dirty → saving → idle
 *      (onCommit here is a no-op delay; status transitions are real).
 *
 * Remove once Phase 1 wires real presence into LettersWorkspace.
 */
export function RealtimeSmoke({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const [focus, setFocus] = useState<PresenceFocus | null>(null);
  const { peers, channel } = usePresence({
    name: "settings-smoke",
    self: { userId, email, focus },
  });
  const [tick, setTick] = useState(0);
  // Force the debug panel to re-read presenceState() every second so we can
  // watch raw entries evolve across track() calls.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const rawState = channel ? channel.presenceState() : {};
  void tick;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Realtime smoke ({peers.length} other {peers.length === 1 ? "user" : "users"})
        </p>
        <AvatarStack peers={peers} />
      </div>

      <SmokeField
        label="Sandbox field 1"
        storageKey="realtime-smoke:field-1"
        peers={peers}
        focusKey={{ table: "sandbox", recordId: "demo", field: "field-1" }}
        setFocus={setFocus}
      />
      <SmokeField
        label="Sandbox field 2"
        storageKey="realtime-smoke:field-2"
        peers={peers}
        focusKey={{ table: "sandbox", recordId: "demo", field: "field-2" }}
        setFocus={setFocus}
      />

      <DebugPanel
        self={{ userId, email, focus }}
        peers={peers}
        rawState={rawState}
      />
    </div>
  );
}

function DebugPanel({
  self,
  peers,
  rawState,
}: {
  self: { userId: string; email: string; focus: PresenceFocus | null };
  peers: PresencePeer[];
  rawState: Record<string, unknown>;
}) {
  const debugText = JSON.stringify(
    {
      self,
      peers: peers.map((p) => ({
        email: p.email,
        color: p.color,
        focus: p.focus,
      })),
      rawState,
    },
    null,
    2
  );

  // onMouseDown preventDefault stops the button from stealing focus from any
  // input that's currently focused — keeps the snapshot in-frame.
  function copy(e: React.MouseEvent) {
    e.preventDefault();
    void navigator.clipboard.writeText(debugText);
  }

  return (
    <details className="rounded-md border border-border bg-muted/40 p-2 text-xs" open>
      <summary className="flex cursor-pointer select-none items-center justify-between font-mono uppercase tracking-widest text-muted-foreground">
        <span>Debug — self + peers</span>
        <button
          type="button"
          onMouseDown={copy}
          className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] normal-case tracking-normal hover:bg-accent"
        >
          Copy
        </button>
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-snug">
        {debugText}
      </pre>
    </details>
  );
}

function SmokeField({
  label,
  storageKey,
  peers,
  focusKey,
  setFocus,
}: {
  label: string;
  storageKey: string;
  peers: PresencePeer[];
  focusKey: PresenceFocus;
  setFocus: (focus: PresenceFocus | null) => void;
}) {
  // Hydrate from localStorage on mount so values survive reloads. Server
  // render returns "" (no window), client hydration syncs.
  const [serverValue, setServerValue] = useState("");
  useEffect(() => {
    setServerValue(window.localStorage.getItem(storageKey) ?? "");
  }, [storageKey]);

  const field = useInstantField<string>({
    value: serverValue,
    onCommit: async (next) => {
      // Simulate a 200ms save so the "saving" status is visible, then
      // persist locally + sync the value-prop so future renders hit the LWW
      // merge rule cleanly.
      await new Promise((r) => setTimeout(r, 200));
      window.localStorage.setItem(storageKey, next);
      setServerValue(next);
    },
    debounceMs: 400,
    onFocusChange: (focused) => setFocus(focused ? focusKey : null),
  });

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <FieldPresence peers={peers} focusKey={focusKey} />
          <StatusGlyph status={field.status} />
        </div>
      </div>
      <input
        type="text"
        value={field.value}
        onChange={(e) => field.set(e.target.value)}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Type here to test debounce + status"
      />
    </div>
  );
}

function StatusGlyph({
  status,
}: {
  status: "idle" | "dirty" | "saving" | "error";
}) {
  const label = {
    idle: "saved",
    dirty: "unsaved",
    saving: "saving…",
    error: "error",
  }[status];
  const color = {
    idle: "text-muted-foreground",
    dirty: "text-amber-500",
    saving: "text-blue-500",
    error: "text-destructive",
  }[status];
  return (
    <span className={`text-[10px] uppercase tracking-widest ${color}`}>
      {label}
    </span>
  );
}
