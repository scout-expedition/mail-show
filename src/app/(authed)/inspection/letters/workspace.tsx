"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { AppPresence } from "@/components/app-presence";
import { usePresenceUser } from "@/components/presence-user-context";
import { useBreadcrumbExtension } from "@/lib/breadcrumb-context";
import { useClaimWorkspacePeers } from "@/lib/realtime/workspace-peer-claims";
import { IconDisplay } from "@/components/icon-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatCitizenIdInput,
  generateRandomCitizenId,
  isValidCitizenId,
} from "@/lib/citizen-id";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";
import type {
  ActionRow,
  ActionTemplate,
  Citizen,
  City,
  Day,
  EndingVariable,
  EndingVariableValue,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import {
  addActionFromTemplate,
  addPieceToLetter,
  createInspectionLettersInGroup,
  createLetterGroupInStoryline,
  createLetterInNextGroup,
  createNextDay,
  createNextDayAndReportSegment,
  createNextLetterGroupAndLetter,
  createReportSegmentForGroup,
  deleteActionRow,
  deleteGroup,
  deleteInspectionLetter,
  deleteReportSegment,
  ensureInspectionLetterVariant,
  patchAction,
  patchActionEndingAssignments,
  patchInspectionLetter,
  patchLetterGroup,
  patchReportSegment,
  quickCreateCitizen,
  reorderInspectionLetters,
  reorderLetterGroups,
  reorderReportSegments,
  updateCitizen,
} from "./actions";
import {
  deleteStoryline,
  patchStoryline,
} from "../storylines/actions";
import { IconPickerDialog } from "@/components/icon-picker-dialog";
import { ImpactTile, NationImpactTile } from "@/components/impact-tile";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import type { PostgresChange } from "@/lib/realtime/channel";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type {
  PresenceFocus,
  PresencePeer,
  PresenceProfile,
  PresenceSelection,
} from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { usePathname, useRouter } from "next/navigation";
import { groupSlug } from "@/lib/letter-groups";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MailOpen,
  Mails,
  Megaphone,
  Milestone,
  MoreVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { paletteColor } from "@/lib/endings/color-palette";
import {
  IconBolt,
  IconCircleMinus,
  IconDiamond,
  IconHammer,
  IconMailOpened,
  IconWorldBolt,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";

/**
 * Selection shape used when this workspace is embedded into another page
 * (e.g., the narrative graph) and needs to be driven by an external
 * parent. Mirrors the workspace's internal drill-down levels.
 */
export type ControlledSelection =
  | { kind: "group"; groupId: string }
  | { kind: "letter"; groupId: string; variantKey: string }
  | { kind: "segment"; segmentId: string }
  | {
      kind: "actions";
      groupId: string;
      variantKey: string;
      actionId?: string;
    };

/**
 * Entry-field look: a darker-than-panel fill that darkens further on
 * hover and shows a visible border on focus. The border stays
 * transparent at rest so the field blends with the panel edges.
 */
const GHOST_FIELD =
  "border-transparent bg-black/35 shadow-none hover:bg-black/50 focus:border-border focus-visible:bg-black/50 focus-visible:shadow-sm";

const CLASS_AFFINITY: Array<{
  key: keyof ActionImpacts;
  label: string;
  icon: ReactNode;
}> = [
  {
    key: "impact_proletariat",
    label: "Working",
    icon: <IconHammer size={14} aria-hidden className="text-amber-500" />,
  },
  {
    key: "impact_gentry",
    label: "Gentry",
    icon: <IconDiamond size={14} aria-hidden className="text-fuchsia-500" />,
  },
];

/** Map a nation name (case-insensitive) to its impact column. */
const NATION_IMPACT_KEYS: Record<string, keyof ActionImpacts> = {
  epicenter: "impact_epicenter",
  folos: "impact_folos",
  emberlyn: "impact_emberlyn",
  spokgrad: "impact_spokgrad",
  pelico: "impact_pelico",
};

type ActionImpacts = {
  impact_world_status: number;
  impact_demerits: number;
  impact_proletariat: number;
  impact_gentry: number;
  impact_epicenter: number;
  impact_folos: number;
  impact_emberlyn: number;
  impact_spokgrad: number;
  impact_pelico: number;
};

/** mail-x — used on the "Clear" option of the Next-letter picker. */
function MailXIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13.5 19H5c-1.105 0-2-.895-2-2V7c0-1.105.895-2 2-2h14c1.105 0 2 .895 2 2v6" />
      <path d="M3 7l9 6 9-6" />
      <path d="M22 22l-5-5" />
      <path d="M17 22l5-5" />
    </svg>
  );
}

/** speakerphone-x — used on the "Clear" option of the Report picker. */
function SpeakerphoneXIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8c1.657 0 3 1.343 3 3s-1.343 3-3 3" />
      <path d="M10 8v11c0 .552-.448 1-1 1h-1c-.552 0-1-.448-1-1v-5" />
      <path d="M14.506 16.088l-2.506-2.088H4c-.552 0-1-.448-1-1v-4c0-.552.448-1 1-1h8" />
      <path d="M12 8l4.524-3.77c.382-.318.949-.266 1.268.116.135.162.209.366.208.576v9.724" />
      <path d="M22 22l-5-5" />
      <path d="M17 22l5-5" />
    </svg>
  );
}

type EndingAssignmentState = {
  variable_id: string;
  /** Nullable: a peer can save an assignment with just the variable picked,
   *  before they commit to a value (matches DB schema since migration 0033). */
  value_id: string | null;
};

type ActionState = ActionImpacts & {
  id: string;
  action_template_id: string | null;
  name: string;
  icon_type: ActionRow["icon_type"];
  icon_value: string | null;
  color_hex: string;
  report_segment_id: string | null;
  next_letter_variant: string | null;
  ending_assignments: EndingAssignmentState[];
};

type LetterState = {
  id: string;
  piece: number | null;
  delivery_day_override_id: string | null;
  summary: string | null;
  content: string | null;
  sender_citizen_id: string | null;
  receiver_citizen_id: string | null;
  notes: string | null;
  actions: ActionState[];
};

function toLetterState(
  l: InspectionLetterView,
  actions: ActionRow[],
  endingAssignments: InspectionActionEndingAssignment[]
): LetterState {
  return {
    id: l.id,
    piece: l.piece,
    delivery_day_override_id: l.delivery_day_override_id,
    summary: l.summary,
    content: l.content,
    sender_citizen_id: l.sender_citizen_id,
    receiver_citizen_id: l.receiver_citizen_id,
    notes: l.notes,
    actions: actions
      .filter((a) => a.inspection_letter_id === l.id)
      .map((a) => ({
        id: a.id,
        action_template_id: a.action_template_id,
        name: a.name,
        icon_type: a.icon_type,
        icon_value: a.icon_value,
        color_hex: a.color_hex,
        report_segment_id: a.report_segment_id,
        next_letter_variant: a.next_letter_variant,
        impact_world_status: a.impact_world_status,
        impact_demerits: a.impact_demerits,
        impact_proletariat: a.impact_proletariat,
        impact_gentry: a.impact_gentry,
        impact_epicenter: a.impact_epicenter,
        impact_folos: a.impact_folos,
        impact_emberlyn: a.impact_emberlyn,
        impact_spokgrad: a.impact_spokgrad,
        impact_pelico: a.impact_pelico,
        ending_assignments: endingAssignments
          .filter((e) => e.action_id === a.id)
          .map((e) => ({
            variable_id: e.variable_id,
            value_id: e.value_id,
          })),
      })),
  };
}

/**
 * True when the viewport is below Tailwind's `lg` breakpoint (1024px).
 * The workspace uses this to swap the slide layout from "two panels
 * side-by-side" (wide) to "one panel at a time" (narrow).
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return narrow;
}

export type LettersWorkspaceProps = {
  storylines: Storyline[];
  groups: LetterGroup[];
  days: Day[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  heroes: Citizen[];
  allCitizenIds: string[];
  cities: City[];
  nations: Nation[];
  segments: ReportSegmentView[];
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
  endingAssignments: InspectionActionEndingAssignment[];
  initialGroupId: string | null;
  initialLetterId: string | null;
  initialSegmentId: string | null;
  /**
   * Optional initial view override. Currently used to land the user on
   * the actions panel when reloading a `?actions=<slug>-<variant>` URL.
   * Requires `initialLetterId` to take effect.
   */
  initialView?: "actions" | null;
  /**
   * Optional controlled selection from a parent (e.g., the narrative
   * graph). When provided, the parent owns the URL and drives the
   * workspace's selection state via useEffect; the workspace skips its
   * internal router.replace sync. Internal selection changes bubble up
   * via onSelectionChange. When undefined, the workspace stays
   * uncontrolled and behaves exactly as on /inspection/letters.
   */
  controlledSelection?: ControlledSelection | null;
  onSelectionChange?: (sel: ControlledSelection | null) => void;
  onClose?: () => void;
  /**
   * When true, force the narrow slide layout (one panel visible at a
   * time). Defaults to tracking the viewport width.
   */
  forceNarrow?: boolean;
  /**
   * Current signed-in user — required to activate realtime presence +
   * instant-save. When either is missing (e.g. from a not-yet-updated
   * graph embed), the workspace renders without presence chrome and
   * fields fall through to their existing save-button paths.
   */
  currentUserId?: string;
  currentEmail?: string;
  /** Local user's display-name / avatar / color from `user_metadata`. Forwarded
   *  to the presence provider so peers see the user's customized identity. */
  currentProfile?: PresenceProfile | null;
  /**
   * When true, the workspace assumes its parent already wraps it in a
   * `WorkspacePresenceProvider`. Skips the internal provider wrap (which
   * would otherwise create a second channel of the same name) AND the
   * floating top-right AvatarStack that mounts in controlled mode — the
   * parent is expected to render presence chrome wherever it wants.
   */
  presenceProvided?: boolean;
};

/**
 * Thin wrapper that provides shared presence + focus state to the
 * workspace body. Read the live values via `usePresenceContext()` inside
 * any child component.
 */
/**
 * Tables the workspace subscribes to via postgres_changes. UPDATE events
 * are column-merged into local mirrors (view-derived columns preserved);
 * DELETE events drop the row and surface a toast if it's the currently-
 * selected one; INSERT events trigger a debounced `router.refresh()` so
 * the RSC layer re-derives view-mapped columns (`content_id`, `report_id`,
 * `effective_day_id`) which aren't in the raw postgres payload.
 */
const POSTGRES_TABLES = [
  "inspection_letters",
  "letter_groups",
  "actions",
  "report_segments",
  "storylines",
  "inspection_action_ending_assignments",
];

export function LettersWorkspace(props: LettersWorkspaceProps) {
  if (props.presenceProvided) {
    return <LettersWorkspaceInner {...props} />;
  }
  return (
    <WorkspacePresenceProvider
      channelName="letters-workspace"
      userId={props.currentUserId}
      email={props.currentEmail}
      profile={props.currentProfile}
      postgresTables={POSTGRES_TABLES}
    >
      <LettersWorkspaceInner {...props} />
    </WorkspacePresenceProvider>
  );
}

function LettersWorkspaceInner({
  storylines: storylinesProp,
  groups: allGroupsProp,
  days,
  letters: allLettersProp,
  actions: allActionsProp,
  templates,
  heroes: initialHeroes,
  allCitizenIds,
  cities,
  nations,
  segments: allSegmentsProp,
  endingVariables,
  endingValues,
  endingAssignments: endingAssignmentsProp,
  initialGroupId,
  initialLetterId,
  initialSegmentId,
  initialView,
  controlledSelection,
  onSelectionChange,
  onClose,
  forceNarrow,
  presenceProvided,
}: LettersWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const presenceUser = usePresenceUser();
  const {
    peers,
    selfPeer,
    setFocus,
    setSelection,
    pingActivity,
    onPostgresChanges,
  } = usePresenceContext();
  const { toast, toaster } = useToast();

  // Viewport-mode flag for the slide layout — hoisted before the selection
  // broadcast effect so it can flow into PresenceSelection.narrow.
  const viewportNarrow = useIsNarrow();
  const narrow = forceNarrow ?? viewportNarrow;

  // Mirror server-provided arrays so postgres_changes events can fan out
  // to the UI without a page reload. Structural mutations still revalidate;
  // when the props change, the "adjust state during render" pattern below
  // resyncs the mirrors back to canonical truth.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [storylines, setStorylines] = useState(storylinesProp);
  const [allGroups, setAllGroups] = useState(allGroupsProp);
  const [allLetters, setAllLetters] = useState(allLettersProp);
  const [allActions, setAllActions] = useState(allActionsProp);
  const [allSegments, setAllSegments] = useState(allSegmentsProp);
  const [endingAssignments, setEndingAssignments] = useState(
    endingAssignmentsProp
  );
  const [prevStorylinesProp, setPrevStorylinesProp] = useState(storylinesProp);
  const [prevGroupsProp, setPrevGroupsProp] = useState(allGroupsProp);
  const [prevLettersProp, setPrevLettersProp] = useState(allLettersProp);
  const [prevActionsProp, setPrevActionsProp] = useState(allActionsProp);
  const [prevSegmentsProp, setPrevSegmentsProp] = useState(allSegmentsProp);
  const [prevEndingAssignmentsProp, setPrevEndingAssignmentsProp] = useState(
    endingAssignmentsProp
  );
  if (storylinesProp !== prevStorylinesProp) {
    setPrevStorylinesProp(storylinesProp);
    setStorylines(storylinesProp);
  }
  if (allGroupsProp !== prevGroupsProp) {
    setPrevGroupsProp(allGroupsProp);
    setAllGroups(allGroupsProp);
  }
  if (allLettersProp !== prevLettersProp) {
    setPrevLettersProp(allLettersProp);
    setAllLetters(allLettersProp);
  }
  if (allActionsProp !== prevActionsProp) {
    setPrevActionsProp(allActionsProp);
    setAllActions(allActionsProp);
  }
  if (allSegmentsProp !== prevSegmentsProp) {
    setPrevSegmentsProp(allSegmentsProp);
    setAllSegments(allSegmentsProp);
  }
  if (endingAssignmentsProp !== prevEndingAssignmentsProp) {
    setPrevEndingAssignmentsProp(endingAssignmentsProp);
    setEndingAssignments(endingAssignmentsProp);
  }
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm({
    scoped: true,
  });
  const storylineById = useMemo(
    () => new Map(storylines.map((s) => [s.id, s])),
    [storylines]
  );

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    initialGroupId
  );
  const group = useMemo(
    () => allGroups.find((g) => g.id === selectedGroupId) ?? null,
    [allGroups, selectedGroupId]
  );

  const letters = useMemo(
    () => allLetters.filter((l) => l.letter_group_id === selectedGroupId),
    [allLetters, selectedGroupId]
  );
  const actions = useMemo(() => {
    const letterIds = new Set(letters.map((l) => l.id));
    return allActions.filter((a) => letterIds.has(a.inspection_letter_id));
  }, [allActions, letters]);
  const segments = useMemo(
    () =>
      group
        ? allSegments.filter((s) => s.letter_group_id === group.id)
        : ([] as ReportSegmentView[]),
    [allSegments, group]
  );

  const nextGroup = useMemo(() => {
    if (!group) return null;
    return (
      allGroups
        .filter(
          (g) => g.storyline_id === group.storyline_id && g.sequence > group.sequence
        )
        .sort((a, b) => a.sequence - b.sequence)[0] ?? null
    );
  }, [allGroups, group]);

  const nextGroupLetters = useMemo(() => {
    if (!nextGroup) return [] as InspectionLetterView[];
    // The action's `next_letter_variant` references a variant key, not a
    // piece id. Collapse multi-piece letters to one row per variant
    // (lowest piece) so the picker doesn't show "L-U3/a", "L-U3/a2",
    // "L-U3/a3" as three separate next-letter targets.
    const seen = new Map<string, InspectionLetterView>();
    for (const l of allLetters) {
      if (l.letter_group_id !== nextGroup.id) continue;
      const k = l.variant ?? "";
      const existing = seen.get(k);
      if (!existing || (l.piece ?? 0) < (existing.piece ?? 0)) {
        seen.set(k, l);
      }
    }
    return Array.from(seen.values()).sort((a, b) => {
      const va = a.variant ?? "";
      const vb = b.variant ?? "";
      return va.localeCompare(vb);
    });
  }, [allLetters, nextGroup]);

  // ----- Group state -----
  const [groupState, setGroupState] = useState(() => ({
    storyline_id: group?.storyline_id ?? "",
    name: group?.name ?? "",
    delivery_day_id: group?.delivery_day_id ?? null,
    notes: group?.notes ?? null,
  }));
  useEffect(() => {
    if (!group) {
      setGroupState({
        storyline_id: "",
        name: "",
        delivery_day_id: null,
        notes: null,
      });
      return;
    }
    setGroupState({
      storyline_id: group.storyline_id,
      name: group.name,
      delivery_day_id: group.delivery_day_id,
      notes: group.notes,
    });
  }, [group]);

  function updateGroup<K extends keyof typeof groupState>(
    k: K,
    v: (typeof groupState)[K]
  ) {
    setGroupState((s) => ({ ...s, [k]: v }));
  }

  // ----- Group panel: instant-save fields -----
  // Each field commits to the server via the narrow patchLetterGroup action
  // after a 400ms debounce, and publishes the user's focus via presence.
  const groupNameField = useInstantField<string>({
    value: group?.name ?? "",
    onCommit: async (next) => {
      if (!group) return;
      await patchLetterGroup(group.id, { name: next });
    },
    onFocusChange: (focused) => {
      if (!group) return setFocus(null);
      setFocus(
        focused
          ? { table: "letter_groups", recordId: group.id, field: "name" }
          : null
      );
    },
    onActivity: pingActivity,
  });
  const groupDayField = useInstantField<string | null>({
    value: group?.delivery_day_id ?? null,
    onCommit: async (next) => {
      if (!group) return;
      await patchLetterGroup(group.id, { delivery_day_id: next });
    },
    onFocusChange: (focused) => {
      if (!group) return setFocus(null);
      setFocus(
        focused
          ? {
              table: "letter_groups",
              recordId: group.id,
              field: "delivery_day_id",
            }
          : null
      );
    },
    onActivity: pingActivity,
  });
  const groupNotesField = useInstantField<string | null>({
    value: group?.notes ?? null,
    onCommit: async (next) => {
      if (!group) return;
      await patchLetterGroup(group.id, { notes: next });
    },
    onFocusChange: (focused) => {
      if (!group) return setFocus(null);
      setFocus(
        focused
          ? { table: "letter_groups", recordId: group.id, field: "notes" }
          : null
      );
    },
    onActivity: pingActivity,
  });
  const groupNameFocus: PresenceFocus | null = group
    ? { table: "letter_groups", recordId: group.id, field: "name" }
    : null;
  const groupDayFocus: PresenceFocus | null = group
    ? {
        table: "letter_groups",
        recordId: group.id,
        field: "delivery_day_id",
      }
    : null;
  const groupNotesFocus: PresenceFocus | null = group
    ? { table: "letter_groups", recordId: group.id, field: "notes" }
    : null;

  // ----- Letter state -----
  const [selectedId, setSelectedId] = useState<string | null>(
    initialLetterId ?? (initialSegmentId ? null : letters[0]?.id ?? null)
  );
  const [letterState, setLetterState] = useState<LetterState | null>(() => {
    const initId =
      initialLetterId ?? (initialSegmentId ? null : letters[0]?.id ?? null);
    const init = initId ? letters.find((l) => l.id === initId) : null;
    return init ? toLetterState(init, actions, endingAssignments) : null;
  });
  const [listLocked, setListLocked] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [segmentListLocked, setSegmentListLocked] = useState(true);
  const [segmentDragIndex, setSegmentDragIndex] = useState<number | null>(null);
  const [segmentOrderOverride, setSegmentOrderOverride] = useState<
    string[] | null
  >(null);
  // Records which surface opened the currently-selected report segment so the
  // segment's back button returns to that surface (actions panel vs. letter
  // group panel) regardless of intermediate state changes.
  const segmentOpenedFromRef = useRef<"actions" | "group" | null>(null);
  // Records the action panel that opened the currently-displayed letter via
  // an action's "open next letter" arrow. The letter's back button reads
  // this to return to the source letter's actions panel.
  const openedNextLetterFromRef = useRef<{
    sourceGroupId: string;
    sourceLetterId: string;
  } | null>(null);
  const [rowPending, startRowAction] = useTransition();
  const [view, setView] = useState<
    "list" | "group" | "main" | "actions" | "segment"
  >(
    initialSegmentId
      ? "segment"
      : initialLetterId
        ? initialView === "actions"
          ? "actions"
          : "main"
        : initialGroupId
          ? "group"
          : "list"
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialSegmentId
  );

  // Latest-selection refs — the postgres_changes handler reads these without
  // re-registering itself on every selection change.
  const selectedGroupIdRef = useRef(selectedGroupId);
  selectedGroupIdRef.current = selectedGroupId;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selectedSegmentIdRef = useRef(selectedSegmentId);
  selectedSegmentIdRef.current = selectedSegmentId;

  // Coalesce bursts of INSERTs (e.g. a single create-action that inserts a
  // group + letter + actions) into one RSC refetch. Refresh trip is cheap
  // enough that we don't need to filter self-echoes — the creator's own
  // revalidatePath already kicked the page; this debounced call lands as
  // a near-no-op in that case.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    []
  );
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      // Wrap in startTransition so Next 16 schedules the RSC refetch
      // alongside React's concurrent work — without this, refreshes
      // dispatched from inside a non-React callback (postgres event)
      // can be coalesced away before they invalidate the route. Confirmed
      // empirically: B doesn't see peer INSERTs without this wrap.
      startTransition(() => {
        router.refresh();
      });
    }, 100);
  }, [router]);

  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      const { table, eventType } = change;
      // Diagnostic toggle: set `localStorage.debug_presence = "1"` in the
      // browser console to log every incoming postgres event from peers.
      // Used to verify the realtime fan-out is reaching this client when
      // remote edits appear to not propagate.
      if (
        typeof window !== "undefined" &&
        window.localStorage?.getItem("debug_presence") === "1"
      ) {
        console.warn("[presence] postgres", eventType, table, change);
      }

      if (eventType === "UPDATE") {
        const newRow = change.new as Record<string, unknown>;
        const id = newRow.id as string | undefined;
        if (!id) return;
        switch (table) {
          case "inspection_letters":
            setAllLetters((prev) =>
              prev.map((r) =>
                r.id === id
                  ? ({ ...r, ...newRow } as unknown as InspectionLetterView)
                  : r
              )
            );
            return;
          case "letter_groups":
            setAllGroups((prev) =>
              prev.map((r) =>
                r.id === id
                  ? ({ ...r, ...newRow } as unknown as LetterGroup)
                  : r
              )
            );
            return;
          case "actions":
            setAllActions((prev) =>
              prev.map((r) =>
                r.id === id ? ({ ...r, ...newRow } as unknown as ActionRow) : r
              )
            );
            return;
          case "report_segments":
            setAllSegments((prev) =>
              prev.map((r) =>
                r.id === id
                  ? ({ ...r, ...newRow } as unknown as ReportSegmentView)
                  : r
              )
            );
            return;
          case "storylines":
            setStorylines((prev) =>
              prev.map((r) =>
                r.id === id ? ({ ...r, ...newRow } as unknown as Storyline) : r
              )
            );
            return;
          case "inspection_action_ending_assignments":
            setEndingAssignments((prev) =>
              prev.map((r) =>
                r.id === id
                  ? ({ ...r, ...newRow } as unknown as InspectionActionEndingAssignment)
                  : r
              )
            );
            return;
        }
        return;
      }

      if (eventType === "DELETE") {
        const oldRow = change.old as Record<string, unknown> | undefined;
        const id = oldRow?.id as string | undefined;
        if (!id) return;
        const deleterEmail =
          (oldRow?.updated_by as string | undefined) ?? null;
        const by = deleterEmail ?? "Someone";

        switch (table) {
          case "inspection_letters":
            setAllLetters((prev) => prev.filter((r) => r.id !== id));
            if (selectedIdRef.current === id) {
              setSelectedId(null);
              setLetterState(null);
              setView("group");
              toast({
                intent: "destructive",
                message: `${by} deleted this letter`,
              });
            }
            return;
          case "letter_groups":
            setAllGroups((prev) => prev.filter((r) => r.id !== id));
            if (selectedGroupIdRef.current === id) {
              setSelectedGroupId(null);
              setSelectedId(null);
              setLetterState(null);
              setSelectedSegmentId(null);
              segmentOpenedFromRef.current = null;
              setView("list");
              toast({
                intent: "destructive",
                message: `${by} deleted this letter group`,
              });
            }
            return;
          case "actions":
            setAllActions((prev) => prev.filter((r) => r.id !== id));
            return;
          case "report_segments":
            setAllSegments((prev) => prev.filter((r) => r.id !== id));
            if (selectedSegmentIdRef.current === id) {
              const target =
                segmentOpenedFromRef.current === "actions"
                  ? "actions"
                  : "group";
              segmentOpenedFromRef.current = null;
              setSelectedSegmentId(null);
              setView(target);
              toast({
                intent: "destructive",
                message: `${by} deleted this report segment`,
              });
            }
            return;
          case "storylines":
            setStorylines((prev) => prev.filter((r) => r.id !== id));
            return;
          case "inspection_action_ending_assignments":
            setEndingAssignments((prev) => prev.filter((r) => r.id !== id));
            return;
        }
        return;
      }

      if (eventType === "INSERT") {
        // Creates from a peer need view-derived columns (content_id,
        // report_id, etc.) which aren't in the postgres payload — and
        // because adding a row can re-compute view fields for OTHER rows
        // (e.g. a second letter in a group flips the existing letter's
        // content_id to include a variant suffix), patching the mirror
        // in-place would leave stale display ids. Fall back to a debounced
        // RSC refetch which gets the views right and reseeds the mirrors.
        //
        // Exception: inspection_action_ending_assignments has no view
        // derivation and no fan-out to other rows, so the raw payload is
        // complete. Patching the mirror in-place avoids forcing an RSC
        // refetch every time a peer adds an ending mapping.
        if (table === "inspection_action_ending_assignments") {
          const newRow = change.new as Record<string, unknown>;
          const row = newRow as unknown as InspectionActionEndingAssignment;
          if (!row.id) return;
          setEndingAssignments((prev) =>
            prev.some((r) => r.id === row.id) ? prev : [...prev, row]
          );
          return;
        }
        scheduleRefresh();
        return;
      }
    });
  }, [onPostgresChanges, toast, scheduleRefresh]);

  const isControlled = !!onSelectionChange;

  // Keep URL in sync with the currently-focused entity. Skipped in
  // controlled mode (parent owns the URL).
  useEffect(() => {
    if (isControlled) return;
    const currentAbbr = group
      ? storylineById.get(group.storyline_id)?.abbreviation ?? ""
      : "";
    const slug = group && currentAbbr ? groupSlug(currentAbbr, group.sequence) : null;
    let target = pathname;
    if (slug) {
      if (selectedSegmentId) {
        const seg = segments.find((s) => s.id === selectedSegmentId);
        if (seg?.variant) {
          target = `${pathname}?report=${encodeURIComponent(`${slug}-${seg.variant}`)}`;
        } else {
          target = `${pathname}?group=${encodeURIComponent(slug)}`;
        }
      } else if (selectedId) {
        const l = letters.find((x) => x.id === selectedId);
        if (l?.variant) {
          const param = view === "actions" ? "actions" : "letter";
          target = `${pathname}?${param}=${encodeURIComponent(`${slug}-${l.variant}`)}`;
        } else {
          target = `${pathname}?group=${encodeURIComponent(slug)}`;
        }
      } else {
        target = `${pathname}?group=${encodeURIComponent(slug)}`;
      }
    }
    router.replace(target, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, selectedId, selectedSegmentId, view, isControlled]);

  // Controlled mode: push the parent's selection into internal state.
  // The ref guard suppresses the reciprocal bubble-up effect on the same
  // tick to avoid loops.
  const controlledApplyRef = useRef(false);
  useEffect(() => {
    if (!onSelectionChange) return;
    const sel = controlledSelection ?? null;
    controlledApplyRef.current = true;
    // Helper: hydrate letterState in the same render so the slot 3
    // render doesn't see a stale letterState.id pointing into the old
    // group's letter list.
    function hydrateLetterState(
      groupId: string,
      variantKey: string
    ): string | null {
      const groupLetters = allLetters.filter(
        (l) => l.letter_group_id === groupId
      );
      const letter = groupLetters.find(
        (l) => (l.variant ?? "") === variantKey
      );
      if (!letter) {
        setLetterState(null);
        return null;
      }
      const groupLetterIds = new Set(groupLetters.map((l) => l.id));
      const groupActions = allActions.filter((a) =>
        groupLetterIds.has(a.inspection_letter_id)
      );
      setLetterState(toLetterState(letter, groupActions, endingAssignments));
      return letter.id;
    }
    if (!sel) {
      setSelectedGroupId(null);
      setSelectedId(null);
      setSelectedSegmentId(null);
      setLetterState(null);
      setView("list");
      return;
    }
    if (sel.kind === "group") {
      setSelectedGroupId(sel.groupId);
      setSelectedId(null);
      setSelectedSegmentId(null);
      setLetterState(null);
      setView("group");
    } else if (sel.kind === "letter") {
      setSelectedGroupId(sel.groupId);
      const letterId = hydrateLetterState(sel.groupId, sel.variantKey);
      setSelectedId(letterId);
      setSelectedSegmentId(null);
      setView("main");
    } else if (sel.kind === "segment") {
      const seg = allSegments.find((s) => s.id === sel.segmentId);
      setSelectedGroupId(seg?.letter_group_id ?? null);
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(sel.segmentId);
      setView("main");
    } else if (sel.kind === "actions") {
      setSelectedGroupId(sel.groupId);
      const letterId = hydrateLetterState(sel.groupId, sel.variantKey);
      setSelectedId(letterId);
      setSelectedSegmentId(null);
      setView("actions");
    }
    // Intentionally only depends on controlledSelection — onSelectionChange
    // is a callback that may be re-created by the parent on every render,
    // and re-firing this effect on identity churn would clobber the
    // user's in-flight edits (resetting letterState + dirty flags).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSelection]);

  // Controlled mode: bubble internal selection state up to the parent.
  // Skipped on the same tick that controlledSelection just applied.
  useEffect(() => {
    if (!onSelectionChange) return;
    if (controlledApplyRef.current) {
      controlledApplyRef.current = false;
      return;
    }
    if (!selectedGroupId && !selectedId && !selectedSegmentId) {
      onSelectionChange(null);
      return;
    }
    if (selectedSegmentId) {
      onSelectionChange({ kind: "segment", segmentId: selectedSegmentId });
      return;
    }
    if (selectedId && selectedGroupId) {
      const letter = allLetters.find((l) => l.id === selectedId);
      const variantKey = letter?.variant ?? "";
      if (view === "actions") {
        onSelectionChange({
          kind: "actions",
          groupId: selectedGroupId,
          variantKey,
        });
      } else {
        onSelectionChange({
          kind: "letter",
          groupId: selectedGroupId,
          variantKey,
        });
      }
      return;
    }
    if (selectedGroupId) {
      onSelectionChange({ kind: "group", groupId: selectedGroupId });
    }
    // Intentionally omits onSelectionChange to avoid re-firing on
    // callback identity churn — see the apply effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, selectedId, selectedSegmentId, view]);

  // Slot 1 can host either a group or a storyline inspector — mutually
  // exclusive. Selecting a storyline clears any active group and vice versa.
  const [selectedStorylineId, setSelectedStorylineId] = useState<string | null>(
    null
  );
  // ----- Panel history: the mouse back/forward buttons navigate between
  // panels in this workspace instead of browser pages. We record a
  // snapshot whenever the focused entity or view changes; mouse-back
  // moves the pointer one snapshot earlier, mouse-forward one later.
  type PanelSnapshot = {
    storylineId: string | null;
    groupId: string | null;
    letterId: string | null;
    segmentId: string | null;
    view: "list" | "group" | "main" | "actions" | "segment";
  };
  const panelHistory = useRef<PanelSnapshot[]>([]);
  const panelIndex = useRef(-1);
  const applyingPanelSnapshot = useRef(false);

  useEffect(() => {
    if (applyingPanelSnapshot.current) {
      applyingPanelSnapshot.current = false;
      return;
    }
    const snap: PanelSnapshot = {
      storylineId: selectedStorylineId,
      groupId: selectedGroupId,
      letterId: selectedId,
      segmentId: selectedSegmentId,
      view,
    };
    const prev = panelHistory.current[panelIndex.current];
    if (
      prev &&
      prev.storylineId === snap.storylineId &&
      prev.groupId === snap.groupId &&
      prev.letterId === snap.letterId &&
      prev.segmentId === snap.segmentId &&
      prev.view === snap.view
    ) {
      return;
    }
    panelHistory.current = [
      ...panelHistory.current.slice(0, panelIndex.current + 1),
      snap,
    ];
    panelIndex.current = panelHistory.current.length - 1;
  }, [
    selectedStorylineId,
    selectedGroupId,
    selectedId,
    selectedSegmentId,
    view,
  ]);

  // Broadcast the local user's open-panel chain so peers can render a
  // location label, jump to the panel, and gauge whether we're sharing a
  // panel. Fires on every change to any of the five selection vars; the
  // presence layer takes care of debouncing duplicates via JSON.stringify.
  useEffect(() => {
    setSelection({
      storylineId: selectedStorylineId,
      groupId: selectedGroupId,
      letterId: selectedId,
      segmentId: selectedSegmentId,
      view,
      narrow,
    });
  }, [
    setSelection,
    selectedStorylineId,
    selectedGroupId,
    selectedId,
    selectedSegmentId,
    view,
    narrow,
  ]);

  // Clear our selection on unmount so a parent surface (e.g. the graph,
  // which keeps the presence provider alive even when the inspector
  // closes) doesn't keep broadcasting a stale "I'm viewing Letter L-…"
  // long after the user has left the panel.
  useEffect(() => {
    return () => {
      setSelection(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function applyPanelSnapshot(s: PanelSnapshot) {
      applyingPanelSnapshot.current = true;
      setSelectedStorylineId(s.storylineId);
      setSelectedGroupId(s.groupId);
      setSelectedId(s.letterId);
      setSelectedSegmentId(s.segmentId);
      setView(s.view);
    }
    function goPanelBack() {
      if (panelIndex.current > 0) {
        panelIndex.current -= 1;
        applyPanelSnapshot(panelHistory.current[panelIndex.current]);
      }
    }
    function goPanelForward() {
      if (panelIndex.current < panelHistory.current.length - 1) {
        panelIndex.current += 1;
        applyPanelSnapshot(panelHistory.current[panelIndex.current]);
      }
    }
    // macOS Chrome doesn't surface the side mouse buttons as JS mouse
    // events we can preventDefault — they go straight to browser-history
    // navigation and only show up via `popstate`. We set up a tiny
    // history "sandwich" (back-trap, mid, forward-trap) and stay parked
    // on `mid`. When the browser pops onto either trap we run the
    // matching panel navigation and silently restore back to mid.
    let lastNavAt = 0;
    function bump() {
      const now = Date.now();
      if (now - lastNavAt < 200) return false;
      lastNavAt = now;
      return true;
    }

    // Mouse / keyboard paths that *do* fire JS events on other browsers.
    function suppress(e: MouseEvent) {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    function navigate(e: MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (!bump()) return;
      if (e.button === 3) void goPanelBack();
      else void goPanelForward();
    }
    function navigateKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const isBack =
        (e.metaKey && e.key === "ArrowLeft") ||
        (e.altKey && e.key === "ArrowLeft");
      const isForward =
        (e.metaKey && e.key === "ArrowRight") ||
        (e.altKey && e.key === "ArrowRight");
      if (!isBack && !isForward) return;
      e.preventDefault();
      e.stopPropagation();
      if (!bump()) return;
      if (isBack) void goPanelBack();
      else void goPanelForward();
    }

    // History sandwich. Build the back / mid / forward entries and park
    // on mid. Subsequent router.replace() in the URL-sync effect updates
    // mid's state but leaves the trap entries untouched.
    let restoring = false;
    history.pushState({ _panelTrap: "back" }, "");
    history.pushState({ _panelTrap: "mid" }, "");
    history.pushState({ _panelTrap: "forward" }, "");
    history.go(-1);

    function onPopState(e: PopStateEvent) {
      if (restoring) {
        restoring = false;
        return;
      }
      const trap = (e.state as { _panelTrap?: string } | null)?._panelTrap;
      if (trap === "back") {
        restoring = true;
        history.forward();
        if (bump()) void goPanelBack();
      } else if (trap === "forward") {
        restoring = true;
        history.back();
        if (bump()) void goPanelForward();
      }
    }

    window.addEventListener("mousedown", suppress, true);
    window.addEventListener("mouseup", navigate, true);
    window.addEventListener("auxclick", navigate, true);
    window.addEventListener("keydown", navigateKey, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("mousedown", suppress, true);
      window.removeEventListener("mouseup", navigate, true);
      window.removeEventListener("auxclick", navigate, true);
      window.removeEventListener("keydown", navigateKey, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  function selectGroup(id: string | null) {
    if (id === selectedGroupId || id === null) {
      // Closing the group — fall back to the storyline inspector so the
      // slide lands on [list + inspector] instead of bouncing home.
      const currentGroup = selectedGroupId
        ? allGroups.find((g) => g.id === selectedGroupId)
        : null;
      const parentStoryline =
        currentGroup?.storyline_id ?? selectedStorylineId ?? null;
      setSelectedGroupId(null);
      setSelectedStorylineId(parentStoryline);
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setView("list");
      return;
    }
    setSelectedGroupId(id);
    setSelectedStorylineId(null);
    setSelectedId(null);
    setLetterState(null);
    setSelectedSegmentId(null);
    // Slide to the group view (inspector + group detail side-by-side).
    setView("group");
  }

  function selectStoryline(id: string | null) {
    setSelectedStorylineId(id);
    setSelectedGroupId(null);
    setSelectedId(null);
    setLetterState(null);
    setSelectedSegmentId(null);
    setView("list");
  }

  // Heroes may grow via quick-create.
  const [heroes, setHeroes] = useState<Citizen[]>(initialHeroes);
  useEffect(() => setHeroes(initialHeroes), [initialHeroes]);

  // When server data reloads, reconcile the selected letter if still present.
  useEffect(() => {
    // Clear local drag order once server data matches.
    setOrderOverride(null);
    if (!selectedId) {
      return;
    }
    const found = letters.find((l) => l.id === selectedId);
    if (!found) {
      // Deleted server-side; fall back to first.
      setSelectedId(letters[0]?.id ?? null);
      setLetterState(
        letters[0] ? toLetterState(letters[0], actions, endingAssignments) : null
      );
      return;
    }
    setLetterState(toLetterState(found, actions, endingAssignments));
  }, [letters, actions, endingAssignments, selectedId]);

  function selectLetter(id: string) {
    if (id === selectedId) {
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      return;
    }
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    setSelectedId(id);
    setLetterState(toLetterState(l, actions, endingAssignments));
    setView("main");
    setSelectedSegmentId(null);
  }

  /**
   * Pick a letter from the list panel — may live in a different group.
   * Switches the active group when needed and lands on the letter view.
   */
  function selectLetterFromList(id: string) {
    const target = allLetters.find((l) => l.id === id);
    if (!target) return;
    if (target.letter_group_id !== selectedGroupId) {
      setSelectedGroupId(target.letter_group_id);
    }
    setSelectedId(id);
    setSelectedSegmentId(null);
    setView("main");
  }

  function closeActionsPanel() {
    setView("main");
  }

  function openSegmentForAction(actionIdx: number) {
    const segId = letterState?.actions[actionIdx]?.report_segment_id ?? null;
    if (!segId) return;
    segmentOpenedFromRef.current = "actions";
    setSelectedSegmentId(segId);
    setView("segment");
  }

  function openLetterForAction(actionIdx: number) {
    const action = letterState?.actions[actionIdx];
    if (!action?.next_letter_variant) return;
    const letter = nextGroupLetters.find(
      (l) => l.variant === action.next_letter_variant
    );
    if (!letter) return;
    // Snapshot the source so the next letter's back button can return to
    // the action panel that initiated this navigation.
    if (selectedGroupId && selectedId) {
      openedNextLetterFromRef.current = {
        sourceGroupId: selectedGroupId,
        sourceLetterId: selectedId,
      };
    }
    // Hydrate letterState synchronously — without this, slot 3 renders
    // null briefly while the old letterState's id no longer matches the
    // new group's letters, producing a flash before the next letter
    // shows.
    const newGroupLetterIds = new Set(
      allLetters
        .filter((l) => l.letter_group_id === letter.letter_group_id)
        .map((l) => l.id)
    );
    const newGroupActions = allActions.filter((a) =>
      newGroupLetterIds.has(a.inspection_letter_id)
    );
    setLetterState(toLetterState(letter, newGroupActions, endingAssignments));
    setSelectedGroupId(letter.letter_group_id);
    setSelectedId(letter.id);
    setSelectedSegmentId(null);
    setView("main");
  }

  /**
   * Open a segment directly from the group panel — used by the "Report
   * segments" list. Segments can be triggered by several actions across
   * different letters; to avoid forcing the user through the
   * actions-of-one-specific-letter path, we slide to view="main" and
   * render the segment card in slot 2 (where the letter fields usually
   * live) instead of going all the way to view="segment".
   */
  function openSegmentFromGroup(segmentId: string) {
    // Clear the letter detail slot as well — otherwise the letter form stays
    // rendered underneath and the segment detail pane never shows.
    segmentOpenedFromRef.current = "group";
    setSelectedId(null);
    setLetterState(null);
    setSelectedSegmentId(segmentId);
    setView("main");
  }

  function closeSegmentPanel() {
    // Always return to the surface that opened the segment. The ref is set
    // by openSegmentForAction / openSegmentFromGroup. When unknown (e.g.,
    // the graph picks a segment directly), fall back based on whether a
    // letter is loaded — matches "Back to actions" when the deep
    // letter→actions path led here, or "Back to group" otherwise.
    const targetView: "main" | "actions" | "group" =
      segmentOpenedFromRef.current === "group"
        ? "group"
        : segmentOpenedFromRef.current === "actions"
          ? "actions"
          : letterState
            ? "actions"
            : "group";
    setView(targetView);
    setSelectedSegmentId(null);
    segmentOpenedFromRef.current = null;
  }

  /**
   * Jump from the segment panel to the actions panel for a specific letter
   * — used by the segment's "Triggers" list. Also switches the group
   * selection if the trigger lives in a different letter group (e.g. a
   * sibling storyline's letter pointing at this segment).
   */
  function jumpToTrigger(letterId: string) {
    const target = allLetters.find((l) => l.id === letterId);
    if (!target) return;
    if (target.letter_group_id !== selectedGroupId) {
      setSelectedGroupId(target.letter_group_id);
    }
    setSelectedId(letterId);
    setSelectedSegmentId(null);
    setView("actions");
  }

  function updateLetter(patch: Partial<LetterState>) {
    setLetterState((s) => (s ? { ...s, ...patch } : s));
  }

  // Per-action debounced patcher. Action fields (next_letter, segment, the
  // 9 impacts) auto-save via the narrow patchAction. ending_assignments
  // stay on the coarse saveLetterActionsOnly path because they're multi-row.
  const actionPatchPendingRef = useRef<Map<string, Partial<ActionState>>>(
    new Map()
  );
  const actionPatchTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const scheduleActionPatch = useCallback(
    (actionId: string, patch: Partial<ActionState>) => {
      const pending =
        actionPatchPendingRef.current.get(actionId) ?? {};
      actionPatchPendingRef.current.set(actionId, { ...pending, ...patch });
      const existing = actionPatchTimersRef.current.get(actionId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        const finalPatch =
          actionPatchPendingRef.current.get(actionId);
        actionPatchPendingRef.current.delete(actionId);
        actionPatchTimersRef.current.delete(actionId);
        if (!finalPatch) return;
        try {
          const { ending_assignments, ...narrow } = finalPatch;
          if (Object.keys(narrow).length > 0) {
            // Cast: remaining keys match patchAction's narrow shape.
            await patchAction(actionId, narrow as never);
          }
          if (ending_assignments !== undefined) {
            await patchActionEndingAssignments(actionId, ending_assignments);
          }
        } catch (e) {
          console.error("patchAction failed:", e);
        }
      }, 400);
      actionPatchTimersRef.current.set(actionId, timer);
    },
    []
  );
  useEffect(() => {
    return () => {
      for (const t of actionPatchTimersRef.current.values()) clearTimeout(t);
      actionPatchTimersRef.current.clear();
      actionPatchPendingRef.current.clear();
    };
  }, []);

  // Throttle the action-edit activity heartbeat to match useInstantField's
  // 5s window. Sustained impact-tile clicks or next-letter cycles fire
  // updateAction rapidly; we don't need to broadcast on every keystroke.
  const lastActionActivityAtRef = useRef(0);
  function pingActionActivity() {
    const now = Date.now();
    if (now - lastActionActivityAtRef.current < 5000) return;
    lastActionActivityAtRef.current = now;
    pingActivity();
  }

  function updateAction(idx: number, patch: Partial<ActionState>) {
    const actionId = letterState?.actions[idx]?.id;
    setLetterState((s) => {
      if (!s) return s;
      const next = s.actions.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...s, actions: next };
    });
    // Auto-save every field — including ending_assignments which fans out
    // to patchActionEndingAssignments inside scheduleActionPatch.
    if (actionId && Object.keys(patch).length > 0) {
      scheduleActionPatch(actionId, patch);
      pingActionActivity();
    }
  }



  async function handleAddLetters(count: number) {
    if (!group) return;
    const groupId = group.id;
    startRowAction(async () => {
      const ids = await createInspectionLettersInGroup(groupId, count);
      if (ids[0]) setSelectedId(ids[0]);
    });
  }

  async function handleAddSegments(count: number) {
    if (!group) return;
    const groupId = group.id;
    startRowAction(async () => {
      for (let i = 0; i < count; i++) {
        await createReportSegmentForGroup(groupId);
      }
    });
  }

  async function handleAddPiece(letterId: string) {
    if (!group) return;
    const groupId = group.id;
    startRowAction(async () => {
      const { newLetterId } = await addPieceToLetter(groupId, letterId);
      setSelectedId(newLetterId);
    });
  }

  async function handleDeleteLetter(id: string) {
    if (!group) return;
    const groupId = group.id;
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    const ok = await confirmDialog({
      title: "Delete letter?",
      message: `${l.content_id} will be permanently removed, along with all of its actions. Any other actions that reference this letter as their next-letter target will be cleared.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startRowAction(async () => {
      await deleteInspectionLetter(groupId, id);
      if (selectedId === id) {
        setSelectedId(null);
        setLetterState(null);
      }
    });
  }

  async function handleDeleteGroup() {
    if (!group) return;
    const groupId = group.id;
    const ok = await confirmDialog({
      title: "Delete letter group?",
      message: `"${group.name}" and everything inside it — all letters, report segments, and actions — will be permanently removed. Any actions in other groups that reference this group's letters will be cleared.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startRowAction(async () => {
      await deleteGroup(groupId);
    });
  }

  function handleAddAction(templateId: string, includePair = true) {
    if (!group) return;
    const groupId = group.id;
    if (!selectedId || !templateId) return;
    startRowAction(async () => {
      await addActionFromTemplate(groupId, selectedId, templateId, includePair);
    });
  }

  async function handleDeleteAction(actionId: string) {
    if (!group) return;
    const groupId = group.id;
    const ok = await confirmDialog({
      title: "Delete action?",
      message: "The action will be permanently removed.",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startRowAction(async () => {
      await deleteActionRow(groupId, actionId);
    });
  }

  function handleDeleteSegment(segmentId: string) {
    startRowAction(async () => {
      await deleteReportSegment(segmentId);
      setSelectedSegmentId(null);
      setView("actions");
    });
  }

  const [heroDialogRole, setHeroDialogRole] = useState<
    "sender" | "receiver" | null
  >(null);
  const [editingCitizen, setEditingCitizen] = useState<Citizen | null>(null);

  async function handleEditCitizen(fields: {
    name: string;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  }) {
    if (!editingCitizen) return;
    await updateCitizen({ id: editingCitizen.id, ...fields });
    const patched: Citizen = {
      ...editingCitizen,
      name: fields.name,
      citizen_id: fields.citizen_id,
      city_id: fields.city_id,
      nation_id: fields.nation_id,
    };
    setHeroes((prev) =>
      prev
        .map((h) => (h.id === patched.id ? patched : h))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingCitizen(null);
  }

  async function handleCreateHero(fields: {
    name: string;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  }) {
    const row = await quickCreateCitizen({
      name: fields.name,
      type: "hero",
      citizen_id: fields.citizen_id,
      city_id: fields.city_id,
      nation_id: fields.nation_id,
    });
    const created: Citizen = {
      id: row.id,
      name: row.name,
      type: row.type,
      citizen_id: row.citizen_id,
      nation_id: row.nation_id,
      city_id: row.city_id,
      notes: null,
    };
    setHeroes((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
    if (heroDialogRole === "sender") {
      updateLetter({ sender_citizen_id: created.id });
    } else if (heroDialogRole === "receiver") {
      updateLetter({ receiver_citizen_id: created.id });
    }
    setHeroDialogRole(null);
  }

  const currentStoryline =
    storylineById.get(groupState.storyline_id) ??
    (selectedStorylineId ? storylineById.get(selectedStorylineId) : undefined);

  /** The storyline the inspector panel (slot 1) is currently bound to. */
  const inspectorStoryline = selectedStorylineId
    ? storylineById.get(selectedStorylineId) ?? null
    : group
      ? storylineById.get(group.storyline_id) ?? null
      : null;

  const selectedLetter = selectedId
    ? letters.find((l) => l.id === selectedId)
    : null;
  const selectedSegment = selectedSegmentId
    ? segments.find((s) => s.id === selectedSegmentId)
    : null;

  // Publish workspace peer userIds so the global AppPresence stack
  // (othersOnly) can dedupe — peers on the letters-workspace channel get
  // hidden from the elsewhere stack even when their app-presence track has
  // drifted (multi-tab / mid-navigation race).
  useClaimWorkspacePeers(peers.map((p) => p.userId));

  // Publish a single deepest-id segment so the AppPresence popup reads
  // "Inspection > <ID>". Priority: segment report_id → letter content_id →
  // group code (storylineAbbrev + sequence) → storyline abbrev → fallback
  // "Letters". The pathname-derived base is just ["Inspection"] for the
  // letters surface so the final popup is exactly two lines.
  useBreadcrumbExtension(
    (() => {
      const ab = currentStoryline?.abbreviation ?? "";
      const id =
        selectedSegment?.report_id ||
        selectedLetter?.content_id ||
        (group ? `G${ab}${group.sequence}` : null) ||
        ab ||
        "Letters";
      return [id];
    })()
  );

  /**
   * Transform offset (as a percentage of the slide container) that moves
   * the desired panels into the viewport. At wide viewports the slide
   * shows two panels at a time; at narrow viewports it shows one (the
   * rightmost open panel, or the lone panel if only one is open).
   */
  const slideOffset = useMemo(() => {
    const baseByView: Record<typeof view, number> = {
      list: 0,
      group: -(100 / 6),
      main: -(100 / 6) * 2,
      actions: -(100 / 6) * 3,
      segment: -(100 / 6) * 4,
    };
    let offset = baseByView[view];
    if (narrow) {
      // At narrow widths show only the rightmost open panel. For the
      // initial "list" view, that's the storyline inspector when
      // something is selected — otherwise the lone list panel.
      const rightPanelHasContent =
        view !== "list" || !!inspectorStoryline;
      if (rightPanelHasContent) offset -= 100 / 6;
    }
    return offset;
  }, [view, narrow, inspectorStoryline]);

  /**
   * Going-up navigation from the breadcrumb. For each panel that would
   * be closed and is dirty, ask the user (one dialog per panel):
   * Save / Don't save / Cancel. Cancel aborts the entire navigation;
   * Save flushes that panel; Don't save drops its edits.
   * Inner-most panels are asked first so users see them in reading
   * order from the panel they were just on.
   */
  function goToBreadcrumb(level: "root" | "group" | "letter" | "actions") {
    if (level === "root") {
      setSelectedGroupId(null);
      setSelectedStorylineId(null);
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setView("list");
    } else if (level === "group") {
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setView("group");
    } else if (level === "letter") {
      setSelectedSegmentId(null);
      setView("main");
    } else if (level === "actions") {
      setSelectedSegmentId(null);
      setView("actions");
    }
  }

  // Build a userId → location label map for the AvatarStack hover popup.
  // Prefer the peer's focused entity (most precise); fall back to the
  // deepest non-null id in their selection chain. Empty entries fall through
  // to "Idle" inside AvatarStack.
  const peerLocations = useMemo(() => {
    const m = new Map<string, string>();
    // Build labels for peers AND the local user — selfPeer carries the same
    // focus/selection fields, so a single pass produces the location string
    // for both, and the hover popup shows e.g. "Letter L-A1/a" instead of
    // a flat "You" when the local user is editing a specific row.
    const all = selfPeer ? [selfPeer, ...peers] : peers;
    for (const peer of all) {
      const label = (() => {
        if (peer.focus) {
          const id = peer.focus.recordId;
          switch (peer.focus.table) {
            case "inspection_letters": {
              const l = allLetters.find((x) => x.id === id);
              if (l?.content_id) return `Letter ${l.content_id}`;
              break;
            }
            case "letter_groups": {
              const g = allGroups.find((x) => x.id === id);
              if (g) {
                const s = storylineById.get(g.storyline_id);
                return `Group ${s?.abbreviation ?? ""}${g.sequence}`;
              }
              break;
            }
            case "actions": {
              const a = allActions.find((x) => x.id === id);
              const l = a
                ? allLetters.find((x) => x.id === a.inspection_letter_id)
                : null;
              if (l?.content_id) return `Actions ${l.content_id}`;
              break;
            }
            case "report_segments": {
              const seg = allSegments.find((x) => x.id === id);
              if (seg?.report_id) return `Report ${seg.report_id}`;
              break;
            }
            case "storylines": {
              const s = storylines.find((x) => x.id === id);
              if (s) return `Storyline ${s.name}`;
              break;
            }
          }
        }
        const sel = peer.selection;
        if (sel) {
          if (sel.segmentId) {
            const seg = allSegments.find((x) => x.id === sel.segmentId);
            if (seg?.report_id) return `Report ${seg.report_id}`;
          }
          if (sel.letterId) {
            const l = allLetters.find((x) => x.id === sel.letterId);
            if (l?.content_id) return `Letter ${l.content_id}`;
          }
          if (sel.groupId) {
            const g = allGroups.find((x) => x.id === sel.groupId);
            if (g) {
              const s = storylineById.get(g.storyline_id);
              return `Group ${s?.abbreviation ?? ""}${g.sequence}`;
            }
          }
          if (sel.storylineId) {
            const s = storylines.find((x) => x.id === sel.storylineId);
            if (s) return `Storyline ${s.name}`;
          }
        }
        return null;
      })();
      if (label) m.set(peer.userId, label);
    }
    return m;
  }, [
    peers,
    selfPeer,
    allLetters,
    allGroups,
    allActions,
    allSegments,
    storylines,
    storylineById,
  ]);

  const selfSelection: PresenceSelection = {
    storylineId: selectedStorylineId,
    groupId: selectedGroupId,
    letterId: selectedId,
    segmentId: selectedSegmentId,
    view,
  };

  // Jump to the peer's panel by applying their selection chain to local state.
  // Mirrors the panel-history snapshot apply path (back/forward navigation).
  function jumpToPeer(peer: PresencePeer) {
    const sel = peer.selection;
    if (!sel) return;
    applyingPanelSnapshot.current = true;
    setSelectedStorylineId(sel.storylineId);
    setSelectedGroupId(sel.groupId);
    setSelectedId(sel.letterId);
    setSelectedSegmentId(sel.segmentId);
    setView(
      (sel.view as "list" | "group" | "main" | "actions" | "segment") ?? "list"
    );
  }

  return (
    <div className="relative flex flex-col gap-6">
      {isControlled ? (
        // In controlled mode the parent surface owns the avatar chrome
        // (graph header). The internal floating stack only renders when
        // no parent provider is wrapping us — i.e. a standalone embed
        // that hasn't adopted the `presenceProvided` contract.
        !presenceProvided && (peers.length > 0 || !!selfPeer) ? (
          <div className="absolute right-2 top-2 z-10">
            <AvatarStack
              peers={peers}
              self={selfPeer}
              selfSelection={selfSelection}
              peerLocations={peerLocations}
              onAvatarClick={jumpToPeer}
              onSelfClick={() => router.push("/settings")}
              narrow={narrow}
            />
          </div>
        ) : null
      ) : (
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-3 font-mono text-sm text-muted-foreground">
        <BreadcrumbLink
          onClick={() => goToBreadcrumb("root")}
          color="#ffffff"
          icon={<IconMailOpened size={13} aria-hidden />}
        >
          Inspection Letters
        </BreadcrumbLink>
        {currentStoryline ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbPill
              onClick={() => goToBreadcrumb("group")}
              active={!group && view === "list"}
            >
              <StorylinePill storyline={currentStoryline} />
            </BreadcrumbPill>
          </>
        ) : null}
        {group ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbPill
              onClick={() => goToBreadcrumb("group")}
              active={view === "group"}
            >
              <LetterGroupPill
                storyline={currentStoryline}
                sequence={group.sequence}
              />
            </BreadcrumbPill>
          </>
        ) : null}
        {selectedLetter ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbPill
              onClick={() => goToBreadcrumb("letter")}
              active={view === "main"}
            >
              <InspectionLetterPill
                storyline={currentStoryline}
                contentId={selectedLetter.content_id}
              />
            </BreadcrumbPill>
          </>
        ) : null}
        {(view === "actions" || view === "segment") && selectedLetter ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              onClick={() => goToBreadcrumb("actions")}
              active={view === "actions"}
              color="#ffffff"
              icon={<Milestone size={12} aria-hidden />}
            >
              Actions
            </BreadcrumbLink>
          </>
        ) : null}
        {selectedSegment ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbPill active={view === "segment"}>
              <ReportSegmentPill
                storyline={currentStoryline}
                reportId={selectedSegment.report_id}
              />
            </BreadcrumbPill>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {/* Global elsewhere-stack — renders LEFT of the self avatar so the
              user is always rightmost. This page has no PageHeader, so
              without this mount the global AppPresence never renders on
              /inspection/letters. othersOnly filters out same-parent-page
              peers so they don't duplicate the workspace stack. */}
          {presenceUser ? (
            <AppPresence
              userId={presenceUser.userId}
              email={presenceUser.email}
              profile={presenceUser.profile}
              othersOnly
            />
          ) : null}
          {/* Workspace-scoped stack (focus rings + per-letter location +
              self avatar). `narrow` flows in so sharesPanel uses the
              "visible slot only" comparison when the local viewport is
              showing one panel at a time. */}
          <AvatarStack
            peers={peers}
            self={selfPeer}
            selfSelection={selfSelection}
            peerLocations={peerLocations}
            onAvatarClick={jumpToPeer}
            onSelfClick={() => router.push("/settings")}
            narrow={narrow}
          />
        </div>
      </div>
      )}

      <div className="relative overflow-hidden">
        <div
          className={cn(
            "flex",
            // Snap (no transition) when embedded in the graph — sliding
            // across intermediate slots would briefly expose their
            // dashed empty-state placeholders.
            forceNarrow ? null : "transition-transform duration-150 ease-out",
            narrow ? "w-[600%]" : "w-[600%] lg:w-[300%]"
          )}
          style={{ transform: `translateX(${slideOffset}%)` }}
        >
        {/* Slot 0 — storylines list (always). */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          <StorylinesListPanel
            storylines={storylines}
            groups={allGroups}
            letters={allLetters}
            days={days}
            selectedGroupId={selectedGroupId}
            selectedLetterId={selectedId}
            selectedStorylineId={selectedStorylineId}
            onSelectGroup={(id) => selectGroup(id)}
            onSelectLetter={(id) => selectLetterFromList(id)}
            onOpenStoryline={(id) => selectStoryline(id)}
          />
        </div>

        {/* Slot 1 — storyline inspector (for selectedStorylineId, or the
            parent of the currently-open letter group). */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          {inspectorStoryline ? (
            <StorylineInspector
              key={inspectorStoryline.id}
              storyline={inspectorStoryline}
              groups={allGroups.filter(
                (g) => g.storyline_id === inspectorStoryline.id
              )}
              allLetters={allLetters}
              days={days}
              selectedGroupId={selectedGroupId}
              onBack={() =>
                group
                  ? selectStoryline(group.storyline_id)
                  : selectStoryline(null)
              }
              onSelectGroup={(id) => selectGroup(id)}
              onCreateGroup={(created) => {
                // Optimistically seed the mirror with the new row so
                // `group = allGroups.find(...)` resolves on the very
                // next render and slot 2 doesn't go blank while the
                // RSC refetch is in flight. The subsequent
                // revalidatePath / router.refresh both reseed to the
                // same canonical row — idempotent.
                setAllGroups((prev) =>
                  prev.some((g) => g.id === created.id)
                    ? prev
                    : [...prev, created]
                );
                selectGroup(created.id);
              }}
              onDeselectGroup={() =>
                selectStoryline(inspectorStoryline.id)
              }
              onConfirmDialog={confirmDialog}
            />
          ) : null}
        </div>

        {/* Slot 2 — letter group card (letters list + report segments
            list). Hidden placeholder when no group is selected. */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          {!group ? null : (
          <>
          <div className="rounded-md border border-border bg-card">
            <PanelHeader
              title="Letter Group"
              icon={<Mails size={14} aria-hidden className="text-muted-foreground/70" />}
              dirty={!!orderOverride}
              showSaved={!!group}
              menu={
                <OverflowMenu
                  items={[
                    {
                      label: "Delete Letter Group",
                      intent: "destructive",
                      icon: <Trash2 size={12} aria-hidden />,
                      onClick: handleDeleteGroup,
                    },
                  ]}
                />
              }
            />
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <BackLink onNavigate={() => selectGroup(null)} />
                <LetterGroupPill
                  storyline={currentStoryline}
                  sequence={group.sequence}
                />
                <FieldHighlight
                  peers={peers}
                  focusKey={groupNameFocus}
                  className="flex-1"
                >
                  <Input
                    value={groupState.name}
                    onChange={(e) => {
                      updateGroup("name", e.target.value);
                      groupNameField.set(e.target.value);
                    }}
                    onFocus={groupNameField.onFocus}
                    onBlur={groupNameField.onBlur}
                    placeholder="Group name"
                    className={cn(
                      "h-7 w-full px-1 text-base font-semibold text-foreground",
                      GHOST_FIELD
                    )}
                  />
                </FieldHighlight>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-6 flex flex-col gap-1">
                  <Label>Delivery day</Label>
                  <FieldHighlight peers={peers} focusKey={groupDayFocus}>
                    <div
                      onFocus={groupDayField.onFocus}
                      onBlur={groupDayField.onBlur}
                    >
                      <DaySelect
                        value={groupState.delivery_day_id ?? ""}
                        days={days}
                        onChange={(v) => {
                          updateGroup("delivery_day_id", v || null);
                          groupDayField.set(v || null);
                        }}
                        className={cn("h-8", GHOST_FIELD)}
                      />
                    </div>
                  </FieldHighlight>
                </div>
                <div className="col-span-6 flex flex-col gap-1">
                  <Label>Notes</Label>
                  <FieldHighlight peers={peers} focusKey={groupNotesFocus}>
                    <AutoTextarea
                      value={groupState.notes ?? ""}
                      onChange={(e) => {
                        updateGroup("notes", e.target.value || null);
                        groupNotesField.set(e.target.value || null);
                      }}
                      onFocus={groupNotesField.onFocus}
                      onBlur={groupNotesField.onBlur}
                      minRows={2}
                      className={GHOST_FIELD}
                    />
                  </FieldHighlight>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-border">
            <div className="flex h-10 items-center gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3">
              <MailOpen
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Letters
              </span>
              <div className="ml-auto flex items-center gap-2">
                <ReorderControls
                  locked={listLocked}
                  dirty={!!orderOverride}
                  pending={rowPending}
                  onUnlock={() => setListLocked(false)}
                  onCancel={() => {
                    setListLocked(true);
                    setOrderOverride(null);
                  }}
                  onSave={() => {
                    if (!orderOverride) return;
                    const final = orderOverride;
                    const groupId = group.id;
                    startRowAction(async () => {
                      await reorderInspectionLetters(groupId, final);
                      setOrderOverride(null);
                      setListLocked(true);
                    });
                  }}
                />
                <OverflowMenu
                  items={[1, 2, 3].map((n) => ({
                    label: n === 1 ? "Letter" : `${n} Letters`,
                    icon: (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden>+</span>
                        <MailOpen size={11} aria-hidden />
                      </span>
                    ),
                    onClick: () => handleAddLetters(n),
                  }))}
                />
              </div>
            </div>
            <div className="flex flex-col overflow-hidden rounded-b-md">
              {(orderOverride
                ? (orderOverride
                    .map((id) => letters.find((x) => x.id === id))
                    .filter(Boolean) as InspectionLetterView[])
                : letters
              ).map((l, i) => {
                const active = l.id === selectedId;
                return (
                  <div
                    key={l.id}
                    draggable={!listLocked}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => {
                      if (listLocked || dragIndex === null || dragIndex === i)
                        return;
                      e.preventDefault();
                      const current = orderOverride ?? letters.map((x) => x.id);
                      const next = current.slice();
                      const [moved] = next.splice(dragIndex, 1);
                      next.splice(i, 0, moved);
                      setOrderOverride(next);
                      setDragIndex(i);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={cn(
                      "flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0",
                      active ? "bg-accent/40" : "hover:bg-accent/15",
                      !listLocked && "cursor-grab active:cursor-grabbing"
                    )}
                  >
                    {!listLocked ? (
                      <span
                        aria-hidden
                        className="text-muted-foreground"
                        title="Drag to reorder"
                      >
                        ⋮⋮
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectLetter(l.id)}
                      disabled={!listLocked}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-grab"
                    >
                      <InspectionLetterPill
                        storyline={currentStoryline}
                        contentId={l.content_id}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {l.summary || (
                          <span className="text-muted-foreground italic">
                            (no summary)
                          </span>
                        )}
                      </span>
                    </button>
                    {listLocked && active ? (
                      <button
                        type="button"
                        onClick={() => handleAddPiece(l.id)}
                        disabled={rowPending}
                        aria-label="Add piece"
                        title="Add piece"
                        className="inline-flex h-5 items-center rounded-sm border border-border/40 px-1.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground disabled:opacity-40"
                      >
                        + Piece
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {letters.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                  No letters in this group yet.
                </p>
              ) : null}
            </div>
              </div>

              <div className="mt-3 rounded-md border border-border">
            <div className="flex h-10 items-center gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3">
              <Megaphone
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Report segments
              </span>
              <div className="ml-auto flex items-center gap-2">
                <ReorderControls
                  locked={segmentListLocked}
                  dirty={!!segmentOrderOverride}
                  pending={rowPending}
                  onUnlock={() => setSegmentListLocked(false)}
                  onCancel={() => {
                    setSegmentListLocked(true);
                    setSegmentOrderOverride(null);
                  }}
                  onSave={() => {
                    if (!segmentOrderOverride) return;
                    const final = segmentOrderOverride;
                    startRowAction(async () => {
                      await reorderReportSegments(final);
                      setSegmentOrderOverride(null);
                      setSegmentListLocked(true);
                    });
                  }}
                />
                <OverflowMenu
                  items={[1, 2, 3].map((n) => ({
                    label:
                      n === 1 ? "Report Segment" : `${n} Report Segments`,
                    icon: (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden>+</span>
                        <Megaphone size={11} aria-hidden />
                      </span>
                    ),
                    onClick: () => handleAddSegments(n),
                  }))}
                />
              </div>
            </div>
            <div className="flex flex-col overflow-hidden rounded-b-md">
              {(segmentOrderOverride
                ? (segmentOrderOverride
                    .map((id) => segments.find((x) => x.id === id))
                    .filter(Boolean) as ReportSegmentView[])
                : segments
              ).map((seg, i) => {
                const active = seg.id === selectedSegmentId;
                const preview = (seg.summary ?? "").trim();
                return (
                  <div
                    key={seg.id}
                    draggable={!segmentListLocked}
                    onDragStart={() => setSegmentDragIndex(i)}
                    onDragOver={(e) => {
                      if (
                        segmentListLocked ||
                        segmentDragIndex === null ||
                        segmentDragIndex === i
                      )
                        return;
                      e.preventDefault();
                      const current =
                        segmentOrderOverride ?? segments.map((x) => x.id);
                      const next = current.slice();
                      const [moved] = next.splice(segmentDragIndex, 1);
                      next.splice(i, 0, moved);
                      setSegmentOrderOverride(next);
                      setSegmentDragIndex(i);
                    }}
                    onDragEnd={() => setSegmentDragIndex(null)}
                    className={cn(
                      "flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0",
                      active ? "bg-accent/40" : "hover:bg-accent/15",
                      !segmentListLocked && "cursor-grab active:cursor-grabbing"
                    )}
                  >
                    {!segmentListLocked ? (
                      <span
                        aria-hidden
                        className="text-muted-foreground"
                        title="Drag to reorder"
                      >
                        ⋮⋮
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openSegmentFromGroup(seg.id)}
                      disabled={!segmentListLocked}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-grab"
                    >
                      <ReportSegmentPill
                        storyline={currentStoryline}
                        reportId={seg.report_id}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {preview ? (
                          preview
                        ) : (
                          <span className="text-muted-foreground italic">
                            (empty)
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
              {segments.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                  No report segments yet.
                </p>
              ) : null}
            </div>
              </div>
            </div>
          </div>
          </>
          )}
        </div>

        {/* Slot 3 — letter fields OR a segment card (when the user
            opened a segment directly from the group panel, no letter
            selected). */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          {letterState && letters.find((l) => l.id === letterState.id) ? (
            <LetterFieldsCard
              key={letterState.id}
              state={letterState}
              letterView={letters.find((l) => l.id === letterState.id)!}
              storyline={currentStoryline}
              groupDeliveryDayId={groupState.delivery_day_id}
              days={days}
              heroes={heroes}
              cities={cities}
              nations={nations}
              onChange={updateLetter}
              onQuickCreateHero={(role) => setHeroDialogRole(role)}
              onEditCitizen={(c) => setEditingCitizen(c)}
              onDelete={() => handleDeleteLetter(letterState.id)}
              onBack={() => {
                // From actions/segment views, "back" steps up one level
                // to the letter detail. From the letter detail itself,
                // it toggles the letter off — unless the letter was
                // opened via an action's "open next letter" arrow, in
                // which case back returns to the source action panel.
                if (view === "actions" || view === "segment") {
                  setView("main");
                  setSelectedSegmentId(null);
                  return;
                }
                const fromAction = openedNextLetterFromRef.current;
                if (fromAction) {
                  openedNextLetterFromRef.current = null;
                  const sourceLetter = allLetters.find(
                    (l) => l.id === fromAction.sourceLetterId
                  );
                  if (sourceLetter) {
                    const sourceGroupLetterIds = new Set(
                      allLetters
                        .filter(
                          (l) => l.letter_group_id === fromAction.sourceGroupId
                        )
                        .map((l) => l.id)
                    );
                    const sourceGroupActions = allActions.filter((a) =>
                      sourceGroupLetterIds.has(a.inspection_letter_id)
                    );
                    setLetterState(
                      toLetterState(
                        sourceLetter,
                        sourceGroupActions,
                        endingAssignments
                      )
                    );
                    setSelectedGroupId(fromAction.sourceGroupId);
                    setSelectedId(fromAction.sourceLetterId);
                    setSelectedSegmentId(null);
                    setView("actions");
                    return;
                  }
                }
                selectLetter(letterState.id);
              }}
              actionsCount={letterState.actions.length}
              actionsActive={view === "actions"}
              onShowActions={() => setView("actions")}
            />
          ) : selectedSegmentId ? (
            <LetterSegmentCard
              key={selectedSegmentId}
              segment={
                segments.find((s) => s.id === selectedSegmentId) ?? null
              }
              days={days}
              groupDeliveryDayId={(() => {
                if (!groupState.delivery_day_id) return null;
                const cur = days.find(
                  (d) => d.id === groupState.delivery_day_id
                );
                if (!cur) return null;
                return (
                  days.find((d) => d.number === cur.number + 1)?.id ?? null
                );
              })()}
              allActions={allActions}
              allLetters={allLetters}
              storylines={storylines}
              templates={templates}
              onBack={closeSegmentPanel}
              onDelete={handleDeleteSegment}
              onJumpToTrigger={jumpToTrigger}
              onConfirmDialog={confirmDialog}
            />
          ) : null}
        </div>

        {/* Slot 4 — action editors for the currently-open letter. */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          {letterState ? (
            <LetterActionsCard
              key={letterState.id}
              actions={letterState.actions}
              templates={templates}
              nations={nations}
              segments={segments}
              storyline={currentStoryline}
              letterContentId={selectedLetter?.content_id ?? ""}
              nextGroup={nextGroup}
              nextGroupLetters={nextGroupLetters}
              groupId={group?.id ?? ""}
              days={days}
              currentLetterDayId={
                letterState.delivery_day_override_id ??
                groupState.delivery_day_id
              }
              endingVariables={endingVariables}
              endingValues={endingValues}
              rowPending={rowPending}
              active={view === "actions"}
              onActionChange={updateAction}
              onAddAction={handleAddAction}
              onDeleteAction={handleDeleteAction}
              onOpenSegment={openSegmentForAction}
              openSegmentId={selectedSegmentId}
              onOpenLetter={openLetterForAction}
              openLetterId={
                selectedGroupId === nextGroup?.id ? selectedId : null
              }
              onBack={closeActionsPanel}
            />
          ) : null}
        </div>

        {/* Slot 5 — report segment opened from an action. */}
        <div className={cn("flex w-1/6 shrink-0 flex-col gap-4", narrow ? null : "px-3")}>
          {selectedSegmentId ? (
            <LetterSegmentCard
              key={selectedSegmentId}
              segment={
                segments.find((s) => s.id === selectedSegmentId) ?? null
              }
              days={days}
              groupDeliveryDayId={(() => {
                // Segment default is the day AFTER the letter group delivers.
                if (!groupState.delivery_day_id) return null;
                const cur = days.find(
                  (d) => d.id === groupState.delivery_day_id
                );
                if (!cur) return null;
                return (
                  days.find((d) => d.number === cur.number + 1)?.id ?? null
                );
              })()}
              allActions={allActions}
              allLetters={allLetters}
              storylines={storylines}
              templates={templates}
              onBack={closeSegmentPanel}
              onDelete={handleDeleteSegment}
              onJumpToTrigger={jumpToTrigger}
              onConfirmDialog={confirmDialog}
            />
          ) : null}
        </div>
        </div>
      </div>

      {heroDialogRole ? (
        <CitizenDialog
          mode="create"
          role={heroDialogRole}
          cities={cities}
          nations={nations}
          allCitizenIds={allCitizenIds}
          onCancel={() => setHeroDialogRole(null)}
          onSubmit={handleCreateHero}
        />
      ) : null}
      {editingCitizen ? (
        <CitizenDialog
          mode="edit"
          existing={editingCitizen}
          cities={cities}
          nations={nations}
          allCitizenIds={allCitizenIds}
          onCancel={() => setEditingCitizen(null)}
          onSubmit={handleEditCitizen}
        />
      ) : null}
      {confirmDialogEl}
      {toaster}
    </div>
  );
}

function LetterFieldsCard({
  state,
  letterView,
  storyline,
  groupDeliveryDayId,
  days,
  heroes,
  cities,
  nations,
  onChange,
  onQuickCreateHero,
  onEditCitizen,
  onDelete,
  onBack,
  actionsCount,
  actionsActive,
  onShowActions,
}: {
  state: LetterState;
  letterView: InspectionLetterView;
  storyline: Storyline | undefined;
  groupDeliveryDayId: string | null;
  days: Day[];
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  onChange: (patch: Partial<LetterState>) => void;
  onQuickCreateHero: (role: "sender" | "receiver") => void;
  onEditCitizen: (citizen: Citizen) => void;
  onDelete: () => void;
  /** Called by the back-arrow in the panel header — typically
   * deselects the current letter, dropping the panel view back to
   * the group card. */
  onBack: () => void;
  actionsCount: number;
  actionsActive: boolean;
  onShowActions: () => void;
}) {
  // The "Delivery Day" dropdown: value is the override; falls back to group day implicitly.
  const currentDayId = state.delivery_day_override_id ?? groupDeliveryDayId;
  const { peers, setFocus, pingActivity } = usePresenceContext();

  function focusKey(field: string): PresenceFocus {
    return { table: "inspection_letters", recordId: state.id, field };
  }
  function onFocusChangeFor(field: string) {
    return (focused: boolean) =>
      setFocus(focused ? focusKey(field) : null);
  }

  // IMPORTANT: useInstantField's `value` must be the SERVER row, not local
  // edit state. The parent's `state.X` is updated synchronously by
  // updateLetter when the user types, so passing it here would make
  // commitNow's equality check think the save was already applied and
  // short-circuit. letterView carries the canonical row from the DB.
  const deliveryOverrideField = useInstantField<string | null>({
    value: letterView.delivery_day_override_id,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, {
        delivery_day_override_id: next,
      });
    },
    onFocusChange: onFocusChangeFor("delivery_day_override_id"),
    onActivity: pingActivity,
  });
  const summaryField = useInstantField<string | null>({
    value: letterView.summary,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, { summary: next });
    },
    onFocusChange: onFocusChangeFor("summary"),
    onActivity: pingActivity,
  });
  const senderField = useInstantField<string | null>({
    value: letterView.sender_citizen_id,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, { sender_citizen_id: next });
    },
    onFocusChange: onFocusChangeFor("sender_citizen_id"),
    onActivity: pingActivity,
  });
  const receiverField = useInstantField<string | null>({
    value: letterView.receiver_citizen_id,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, { receiver_citizen_id: next });
    },
    onFocusChange: onFocusChangeFor("receiver_citizen_id"),
    onActivity: pingActivity,
  });
  const contentField = useInstantField<string | null>({
    value: letterView.content,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, { content: next });
    },
    onFocusChange: onFocusChangeFor("content"),
    onActivity: pingActivity,
  });
  const notesField = useInstantField<string | null>({
    value: letterView.notes,
    onCommit: async (next) => {
      await patchInspectionLetter(state.id, { notes: next });
    },
    onFocusChange: onFocusChangeFor("notes"),
    onActivity: pingActivity,
  });

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Inspection Letter"
        icon={<MailOpen size={14} aria-hidden className="text-muted-foreground/70" />}
        showSaved
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete Inspection Letter",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: onDelete,
              },
            ]}
          />
        }
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <BackLink onNavigate={onBack} />
        <InspectionLetterPill
          storyline={storyline}
          contentId={letterView.content_id}
        />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Group delivery</Label>
          <div
            className={cn(
              "flex h-8 items-center rounded-md border border-transparent px-3 font-mono text-sm text-muted-foreground"
            )}
          >
            {days.find((d) => d.id === groupDeliveryDayId)?.identifier ?? "—"}
          </div>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Delivery override</Label>
          <FieldHighlight
            peers={peers}
            focusKey={focusKey("delivery_day_override_id")}
          >
            <div
              onFocus={deliveryOverrideField.onFocus}
              onBlur={deliveryOverrideField.onBlur}
            >
              <DaySelect
                value={currentDayId ?? ""}
                days={days}
                groupDefaultId={groupDeliveryDayId}
                dashWhenGroupDefault
                hideClear
                onChange={(v) => {
                  const next =
                    !v ? null : v === groupDeliveryDayId ? null : v;
                  onChange({ delivery_day_override_id: next });
                  deliveryOverrideField.set(next);
                }}
                className={cn(
                  "h-8",
                  GHOST_FIELD,
                  state.delivery_day_override_id
                    ? undefined
                    : "text-muted-foreground/60"
                )}
              />
            </div>
          </FieldHighlight>
        </div>
        <div className="col-span-2 flex flex-col items-end gap-1">
          <Label>Actions</Label>
          <button
            type="button"
            onClick={onShowActions}
            aria-label={`Show ${actionsCount} action${actionsCount === 1 ? "" : "s"}`}
            title="Show actions"
            aria-pressed={actionsActive}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1 rounded-md border px-2 transition-colors",
              actionsActive
                ? "border-foreground/60 bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Milestone size={14} aria-hidden />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="col-span-6 flex flex-col gap-1">
          <Label>Summary</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("summary")}>
            <Input
              value={state.summary ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                onChange({ summary: next });
                summaryField.set(next);
              }}
              onFocus={summaryField.onFocus}
              onBlur={summaryField.onBlur}
              className={cn("h-8 w-full", GHOST_FIELD)}
            />
          </FieldHighlight>
        </div>

        <div className="col-span-3 flex flex-col gap-1">
          <Label>Sender</Label>
          <FieldHighlight
            peers={peers}
            focusKey={focusKey("sender_citizen_id")}
          >
            <div onFocus={senderField.onFocus} onBlur={senderField.onBlur}>
              <HeroSearch
                value={state.sender_citizen_id}
                heroes={heroes}
                cities={cities}
                nations={nations}
                onChange={(v) => {
                  onChange({ sender_citizen_id: v });
                  senderField.set(v);
                }}
                onCreate={() => onQuickCreateHero("sender")}
                onEdit={onEditCitizen}
              />
            </div>
          </FieldHighlight>
        </div>
        <div className="col-span-3 flex flex-col gap-1">
          <Label>Receiver</Label>
          <FieldHighlight
            peers={peers}
            focusKey={focusKey("receiver_citizen_id")}
          >
            <div onFocus={receiverField.onFocus} onBlur={receiverField.onBlur}>
              <HeroSearch
                value={state.receiver_citizen_id}
                heroes={heroes}
                cities={cities}
                nations={nations}
                onChange={(v) => {
                  onChange({ receiver_citizen_id: v });
                  receiverField.set(v);
                }}
                onCreate={() => onQuickCreateHero("receiver")}
                onEdit={onEditCitizen}
              />
            </div>
          </FieldHighlight>
        </div>

        <div className="col-span-6 flex flex-col gap-1">
          <Label>Content</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("content")}>
            <div onFocus={contentField.onFocus} onBlur={contentField.onBlur}>
              <MarkdownTextarea
                value={state.content ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  onChange({ content: next });
                  contentField.set(next);
                }}
                minRows={6}
                className={cn("font-mono text-xs", GHOST_FIELD)}
              />
            </div>
          </FieldHighlight>
        </div>
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Notes</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("notes")}>
            <AutoTextarea
              value={state.notes ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                onChange({ notes: next });
                notesField.set(next);
              }}
              onFocus={notesField.onFocus}
              onBlur={notesField.onBlur}
              minRows={2}
              className={GHOST_FIELD}
            />
          </FieldHighlight>
        </div>
      </div>

      {peers.some((p) => p.focus?.recordId === state.id) ? null : (
        <LastUpdatedFooter at={letterView.updated_at} by={letterView.updated_by} />
      )}
      </div>
    </div>
  );
}

function LetterActionsCard({
  actions,
  templates,
  nations,
  segments,
  storyline,
  letterContentId,
  nextGroup,
  nextGroupLetters,
  groupId,
  days,
  currentLetterDayId,
  endingVariables,
  endingValues,
  rowPending,
  active,
  onActionChange,
  onAddAction,
  onDeleteAction,
  onOpenSegment,
  openSegmentId,
  onOpenLetter,
  openLetterId,
  onBack,
}: {
  actions: ActionState[];
  templates: ActionTemplate[];
  nations: Nation[];
  segments: ReportSegmentView[];
  storyline: Storyline | undefined;
  letterContentId: string;
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
  groupId: string;
  days: Day[];
  currentLetterDayId: string | null;
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
  rowPending: boolean;
  /** True while the actions panel is the visible slide step. Flipping
   *  this true moves keyboard focus into the panel. */
  active: boolean;
  onActionChange: (idx: number, patch: Partial<ActionState>) => void;
  onAddAction: (templateId: string, includePair?: boolean) => void;
  onDeleteAction: (actionId: string) => void;
  onOpenSegment: (actionIdx: number) => void;
  openSegmentId: string | null;
  onOpenLetter: (actionIdx: number) => void;
  openLetterId: string | null;
  onBack: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // When the panel becomes the active slide step, pull focus into it so
  // the next Tab lands on the panel's first control rather than wherever
  // focus was on the previous panel.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      panelRef.current?.focus();
    }
    wasActiveRef.current = active;
  }, [active]);
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="rounded-md border border-border bg-card focus:outline-none"
    >
      <PanelHeader
        title="Letter Actions"
        icon={
          <IconBolt
            size={14}
            aria-hidden
            className="text-muted-foreground/70"
          />
        }
        showSaved
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <BackLink onNavigate={onBack} label="Back to letter" />
        <InspectionLetterPill
          storyline={storyline}
          contentId={letterContentId}
        />
      </div>
      <div className="flex flex-col gap-3">
        {actions.map((a, i) => (
          <ActionEditor
            key={a.id}
            action={a}
            templates={templates}
            nations={nations}
            segments={segments}
            storyline={storyline}
            nextGroup={nextGroup}
            nextGroupLetters={nextGroupLetters}
            groupId={groupId}
            days={days}
            currentLetterDayId={currentLetterDayId}
            endingVariables={endingVariables}
            endingValues={endingValues}
            onChange={(patch) => onActionChange(i, patch)}
            onDelete={() => onDeleteAction(a.id)}
            onOpenSegment={() => onOpenSegment(i)}
            segmentOpen={
              !!a.report_segment_id && a.report_segment_id === openSegmentId
            }
            onOpenLetter={() => onOpenLetter(i)}
            letterOpen={
              !!a.next_letter_variant &&
              (nextGroupLetters.find((l) => l.variant === a.next_letter_variant)
                ?.id ?? null) === openLetterId
            }
          />
        ))}
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions yet.</p>
        ) : null}
        <div className="flex justify-center pt-1">
          <AddActionMenu
            templates={templates}
            disabled={rowPending || templates.length === 0}
            onAdd={(templateId, includePair) =>
              onAddAction(templateId, includePair)
            }
          />
        </div>
      </div>
      </div>
    </div>
  );
}

function LetterSegmentCard({
  segment,
  days,
  groupDeliveryDayId,
  allActions,
  allLetters,
  storylines,
  templates,
  onBack,
  onDelete,
  onJumpToTrigger,
  onConfirmDialog,
}: {
  segment: ReportSegmentView | null;
  days: Day[];
  groupDeliveryDayId: string | null;
  allActions: ActionRow[];
  allLetters: InspectionLetterView[];
  storylines: Storyline[];
  templates: ActionTemplate[];
  onBack: () => void;
  onDelete: (segmentId: string) => void;
  onJumpToTrigger: (letterId: string) => void;
  onConfirmDialog: (options: {
    title: string;
    message?: string;
    confirmLabel?: string;
    intent?: "destructive" | "default";
  }) => Promise<boolean>;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const segmentId = segment?.id ?? "";

  function focusKey(field: string): PresenceFocus {
    return { table: "report_segments", recordId: segmentId, field };
  }
  function onFocusChangeFor(field: string) {
    return (focused: boolean) =>
      setFocus(focused ? focusKey(field) : null);
  }

  // IMPORTANT: useInstantField's `value` MUST be the canonical server row
  // (segment.X), not local edit state — otherwise commitNow's equality
  // check short-circuits the save. See Track B3 lesson in
  // docs/multi-user-collab-plan.md.
  const variantField = useInstantField<string>({
    value: segment?.variant ?? "",
    onCommit: async (next) => {
      if (!segment) return;
      const value = next.trim() || segment.variant;
      await patchReportSegment(segment.id, { variant: value });
    },
    onFocusChange: onFocusChangeFor("variant"),
    onActivity: pingActivity,
  });
  const dayField = useInstantField<string | null>({
    value: segment?.delivery_day_override_id ?? null,
    onCommit: async (next) => {
      if (!segment) return;
      await patchReportSegment(segment.id, {
        delivery_day_override_id: next,
      });
    },
    onFocusChange: onFocusChangeFor("delivery_day_override_id"),
    onActivity: pingActivity,
  });
  const summaryField = useInstantField<string | null>({
    value: segment?.summary ?? null,
    onCommit: async (next) => {
      if (!segment) return;
      await patchReportSegment(segment.id, { summary: next });
    },
    onFocusChange: onFocusChangeFor("summary"),
    onActivity: pingActivity,
  });
  const contentField = useInstantField<string | null>({
    value: segment?.content ?? null,
    onCommit: async (next) => {
      if (!segment) return;
      await patchReportSegment(segment.id, { content: next });
    },
    onFocusChange: onFocusChangeFor("content"),
    onActivity: pingActivity,
  });

  type Trigger = {
    actionId: string;
    actionName: string;
    actionIconType: IconType;
    actionIconValue: string | null;
    actionColorHex: string;
    letterId: string;
    contentId: string;
    storylineId: string;
  };
  const triggers = useMemo(() => {
    if (!segment) return [] as Trigger[];
    return allActions
      .filter((a) => a.report_segment_id === segment.id)
      .map((a): Trigger | null => {
        const letter = allLetters.find((l) => l.id === a.inspection_letter_id);
        if (!letter) return null;
        const tpl = a.action_template_id
          ? templates.find((t) => t.id === a.action_template_id)
          : undefined;
        return {
          actionId: a.id,
          actionName: tpl?.name ?? a.name,
          actionIconType: tpl?.icon_type ?? a.icon_type,
          actionIconValue: tpl?.icon_value ?? a.icon_value,
          actionColorHex: tpl?.color_hex ?? a.color_hex,
          letterId: letter.id,
          contentId: letter.content_id,
          storylineId: letter.storyline_id,
        };
      })
      .filter((v): v is Trigger => v !== null);
  }, [segment, allActions, allLetters, templates]);

  if (!segment) {
    return (
      <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Segment not available.
      </div>
    );
  }

  const currentDayId = dayField.value;
  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Report Segment"
        icon={<Megaphone size={14} aria-hidden className="text-muted-foreground/70" />}
        showSaved
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete Report Segment",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: async () => {
                  const ok = await onConfirmDialog({
                    title: "Delete report segment?",
                    message: `Segment ${segment.report_id} will be removed from the report. This cannot be undone.`,
                    confirmLabel: "Delete",
                    intent: "destructive",
                  });
                  if (!ok) return;
                  onDelete(segment.id);
                },
              },
            ]}
          />
        }
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <BackLink onNavigate={onBack} label="Back to actions" />
        <ReportSegmentPill
          storyline={storylines.find((s) => s.id === segment.storyline_id)}
          reportId={segment.report_id}
        />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Variant</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("variant")}>
            <Input
              value={variantField.value}
              onChange={(e) =>
                variantField.set(formatRomanInput(e.target.value))
              }
              onFocus={variantField.onFocus}
              onBlur={variantField.onBlur}
              placeholder="i"
              className={cn(
                "h-8 w-full lowercase",
                GHOST_FIELD,
                variantField.value && !isValidRoman(variantField.value)
                  ? "ring-2 ring-destructive"
                  : undefined
              )}
            />
          </FieldHighlight>
        </div>
        <div className="col-span-4 flex flex-col gap-1">
          <Label>Delivery day</Label>
          <FieldHighlight
            peers={peers}
            focusKey={focusKey("delivery_day_override_id")}
          >
            <div onFocus={dayField.onFocus} onBlur={dayField.onBlur}>
              <DaySelect
                value={(currentDayId ?? groupDeliveryDayId) ?? ""}
                days={days}
                groupDefaultId={groupDeliveryDayId}
                defaultSuffix="(Following Day)"
                onChange={(v) =>
                  dayField.set(
                    !v ? null : v === groupDeliveryDayId ? null : v
                  )
                }
                className={cn("h-8", GHOST_FIELD)}
              />
            </div>
          </FieldHighlight>
        </div>
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Summary</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("summary")}>
            <Input
              value={summaryField.value ?? ""}
              onChange={(e) => summaryField.set(e.target.value || null)}
              onFocus={summaryField.onFocus}
              onBlur={summaryField.onBlur}
              className={cn("h-8 w-full", GHOST_FIELD)}
            />
          </FieldHighlight>
        </div>
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Content</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("content")}>
            <div onFocus={contentField.onFocus} onBlur={contentField.onBlur}>
              <MarkdownTextarea
                value={contentField.value ?? ""}
                onChange={(e) => contentField.set(e.target.value || null)}
                minRows={8}
                className={cn("font-mono text-xs", GHOST_FIELD)}
              />
            </div>
          </FieldHighlight>
        </div>
      </div>
      {triggers.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Triggers ({triggers.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {triggers.map((t) => {
              const s = storylines.find((x) => x.id === t.storylineId);
              return (
                <button
                  key={t.actionId}
                  type="button"
                  onClick={() => onJumpToTrigger(t.letterId)}
                  title={`Jump to ${t.contentId} · ${t.actionName}`}
                  className="inline-flex items-center rounded-md transition-opacity hover:opacity-80"
                >
                  <InspectionLetterPill
                    storyline={s}
                    contentId={t.contentId}
                    className="rounded-r-none"
                  />
                  <ActionPill
                    name={t.actionName}
                    iconType={t.actionIconType}
                    iconValue={t.actionIconValue}
                    colorHex={t.actionColorHex}
                    iconOnly
                    className="rounded-l-none"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {peers.some((p) => p.focus?.recordId === segment.id) ? null : (
        <LastUpdatedFooter at={segment.updated_at} by={segment.updated_by} />
      )}
      </div>
    </div>
  );
}

function addressParts(
  hero: Citizen,
  cities: City[],
  nations: Nation[]
): { citizenId: string | null; cityName: string | null; nation: Nation | null } {
  const city = hero.city_id ? cities.find((c) => c.id === hero.city_id) : null;
  const nation = hero.nation_id
    ? nations.find((n) => n.id === hero.nation_id) ?? null
    : null;
  return {
    citizenId: hero.citizen_id,
    cityName: city?.name ?? null,
    nation,
  };
}

function AddressLine({
  parts,
  compact,
  wrap,
}: {
  parts: ReturnType<typeof addressParts>;
  /** No left padding — the row sits flush with its container. */
  compact?: boolean;
  /** Allow the address to wrap to multiple lines instead of truncating. */
  wrap?: boolean;
}) {
  const hasAny = parts.citizenId || parts.cityName || parts.nation;
  const pieces: React.ReactNode[] = [];
  if (parts.citizenId)
    pieces.push(<span key="cid">{parts.citizenId}</span>);
  if (parts.cityName)
    pieces.push(<span key="city">{parts.cityName}</span>);
  if (parts.nation)
    pieces.push(
      <span key="nation" style={{ color: parts.nation.color_hex }}>
        {parts.nation.name}
      </span>
    );
  return (
    <span
      className={cn(
        "block text-[10px] leading-[14px] text-muted-foreground",
        compact ? null : "pl-3",
        wrap ? null : "h-[14px] truncate"
      )}
    >
      {hasAny
        ? pieces.map((el, i) => (
            <span key={i}>
              {i > 0 ? <span className="mx-1 opacity-60">·</span> : null}
              {el}
            </span>
          ))
        : null}
    </span>
  );
}

function HeroSearch({
  value,
  heroes,
  cities,
  nations,
  onChange,
  onCreate,
  onEdit,
}: {
  value: string | null;
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  onChange: (v: string | null) => void;
  onCreate: () => void;
  onEdit: (citizen: Citizen) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = heroes.find((h) => h.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? heroes
      : heroes.filter((h) => h.name.toLowerCase().includes(q));
    return list.slice(0, 8);
  }, [heroes, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (selected) {
    const parts = addressParts(selected, cities, nations);
    return (
      <div className="group flex flex-col rounded-md bg-black/35 px-3 py-1">
        <div className="flex h-5 items-center justify-between gap-2">
          <span className="truncate text-[10px]">{selected.name}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(selected)}
              aria-label="Edit citizen"
              title="Edit citizen"
              className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Clear selection"
              title="Clear"
              className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        <AddressLine parts={parts} compact />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Same chrome as the selected state — input on the top row, an
          empty address row below — so selecting/clearing a citizen
          doesn't change the field's height. */}
      <div className="group flex flex-col rounded-md bg-black/35 px-3 py-1 transition-colors focus-within:bg-black/50 hover:bg-black/50">
        <div className="flex h-5 items-center gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="h-5 min-w-0 flex-1 bg-transparent text-[10px] leading-5 focus:outline-none"
          />
          <button
            type="button"
            onClick={onCreate}
            aria-label="Create new hero"
            title="Create new hero"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            +
          </button>
        </div>
        <AddressLine
          parts={{ citizenId: null, cityName: null, nation: null }}
          compact
        />
      </div>
      {open && matches.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-md">
          {matches.map((h) => {
            const parts = addressParts(h, cities, nations);
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onChange(h.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent/40"
              >
                <span className="text-[10px]">{h.name}</span>
                <AddressLine parts={parts} compact wrap />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CitizenDialog({
  mode,
  role,
  existing,
  cities,
  nations,
  allCitizenIds,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  role?: "sender" | "receiver";
  existing?: Citizen | null;
  cities: City[];
  nations: Nation[];
  allCitizenIds: string[];
  onCancel: () => void;
  onSubmit: (fields: {
    name: string;
    citizen_id: string | null;
    city_id: string | null;
    nation_id: string | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [citizenId, setCitizenId] = useState(existing?.citizen_id ?? "");
  const [cityId, setCityId] = useState(existing?.city_id ?? "");
  const [nationId, setNationId] = useState(existing?.nation_id ?? "");
  const [pending, startTransition] = useTransition();

  const cityById = useMemo(
    () => new Map(cities.map((c) => [c.id, c])),
    [cities]
  );
  const availableCities = useMemo(
    () => (nationId ? cities.filter((c) => c.nation_id === nationId) : cities),
    [cities, nationId]
  );
  const takenIds = useMemo(() => {
    const s = new Set(allCitizenIds);
    if (existing?.citizen_id) s.delete(existing.citizen_id);
    return s;
  }, [allCitizenIds, existing]);

  function updateNation(v: string) {
    setNationId(v);
    if (cityId) {
      const currentCity = cityById.get(cityId);
      if (currentCity && currentCity.nation_id !== v) setCityId("");
    }
  }
  function updateCity(v: string) {
    setCityId(v);
    if (v) {
      const city = cityById.get(v);
      if (city) setNationId(city.nation_id);
    }
  }

  const cidInvalid = citizenId.length > 0 && !isValidCitizenId(citizenId);
  const cidDuplicate = citizenId.length > 0 && takenIds.has(citizenId);
  const canSubmit = name.trim().length > 0 && !cidInvalid && !cidDuplicate && !pending;
  const title =
    mode === "edit"
      ? `Edit citizen · ${existing?.name ?? ""}`
      : role
        ? `New ${role} · Hero`
        : "New citizen · Hero";
  const submitLabel = mode === "edit" ? "Save changes" : "Create citizen";
  const submitPendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      await onSubmit({
        name: name.trim(),
        citizen_id: citizenId.trim() || null,
        city_id: cityId || null,
        nation_id: nationId || null,
      });
    });
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Citizen ID</Label>
            <div className="relative flex items-center">
              <Input
                value={citizenId}
                onChange={(e) => setCitizenId(formatCitizenIdInput(e.target.value))}
                placeholder="#0042"
                maxLength={5}
                className={cn(
                  "h-8 pr-8",
                  (cidInvalid || cidDuplicate) &&
                    "ring-2 ring-destructive ring-offset-0"
                )}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCitizenId(generateRandomCitizenId(takenIds))}
                aria-label="Generate random citizen ID"
                title="Generate random ID"
                className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.1" fill="currentColor" />
                  <circle cx="16" cy="16" r="1.1" fill="currentColor" />
                </svg>
              </button>
            </div>
            {cidDuplicate ? (
              <span className="text-[11px] text-destructive">
                That citizen ID is already in use.
              </span>
            ) : cidInvalid ? (
              <span className="text-[11px] text-destructive">
                Use # + 4 chars (A–Z without I, or 0–9).
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Leave blank or click the die for a random ID.
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>City</Label>
              <Select
                value={cityId}
                onChange={(e) => updateCity(e.target.value)}
                className="h-8"
              >
                <option value="">—</option>
                {availableCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Nation</Label>
              <Select
                value={nationId}
                onChange={(e) => updateNation(e.target.value)}
                className="h-8"
              >
                <option value="">—</option>
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {pending ? (
              <>
                <Spinner />
                {submitPendingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  minRows = 2,
  className,
  ...rest
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  className?: string;
} & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "rows" | "className"
>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      className={cn("resize-none overflow-hidden", className)}
      {...rest}
    />
  );
}

/**
 * Auto-resizing textarea that shows a markdown-formatting toolbar above the
 * field while it has focus. The toolbar buttons preserve focus via mousedown
 * preventDefault, and mutate the textarea using the native input event so
 * React's onChange pipeline stays in charge of state.
 */
function MarkdownTextarea({
  value,
  onChange,
  minRows = 6,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [caretOnFirstLine, setCaretOnFirstLine] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Recompute whether the caret is on the first visual line of the
  // textarea. When it is, the floating toolbar slides down so it
  // doesn't obstruct the text the user is editing.
  function updateCaretPosition() {
    const el = ref.current;
    if (!el) {
      setCaretOnFirstLine(false);
      return;
    }
    // Text before the caret; first line if it has no newline.
    const before = el.value.slice(0, el.selectionStart);
    setCaretOnFirstLine(!before.includes("\n"));
  }

  function fireInput(el: HTMLTextAreaElement, next: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrap(before: string, after: string, placeholder: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const insert = selected || placeholder;
    const next = value.slice(0, start) + before + insert + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + insert.length;
    fireInput(el, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function linePrefix(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = value.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const block = value.slice(lineStart, end);
    const lines = block.length > 0 ? block.split("\n") : [""];
    const prefixed = lines.map((l) => prefix + l).join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(end);
    const addedLen = prefixed.length - block.length;
    fireInput(el, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart + prefix.length, end + addedLen);
    });
  }

  const BTN =
    "inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <div
      className="relative flex w-full flex-col"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e);
          updateCaretPosition();
        }}
        onKeyUp={updateCaretPosition}
        onClick={updateCaretPosition}
        onSelect={updateCaretPosition}
        onFocus={updateCaretPosition}
        rows={minRows}
        className={cn("resize-none overflow-hidden", className)}
      />
      <div
        className={cn(
          "pointer-events-none absolute right-2 flex items-center gap-0.5 rounded-md border border-border bg-card/95 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-[opacity,top] duration-150",
          focused ? "opacity-100" : "opacity-0",
          // Dodge the caret when it's sitting on the first line so the
          // toolbar isn't hovering over what the user is typing.
          caretOnFirstLine ? "top-9" : "top-2"
        )}
        aria-hidden={!focused}
      >
        <div
          className={cn(
            "flex items-center gap-0.5",
            focused ? "pointer-events-auto" : ""
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            title="Bold"
            aria-label="Bold"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("**", "**", "bold");
            }}
            className={cn(BTN, "font-bold")}
          >
            B
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Italic"
            aria-label="Italic"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("*", "*", "italic");
            }}
            className={cn(BTN, "italic")}
          >
            I
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Heading"
            aria-label="Heading"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("## ");
            }}
            className={cn(BTN, "font-semibold")}
          >
            H
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
          <button
            type="button"
            tabIndex={-1}
            title="Bullet list"
            aria-label="Bullet list"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("- ");
            }}
            className={BTN}
          >
            •
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Numbered list"
            aria-label="Numbered list"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("1. ");
            }}
            className={BTN}
          >
            1.
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Quote"
            aria-label="Quote"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("> ");
            }}
            className={BTN}
          >
            ❝
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
          <button
            type="button"
            tabIndex={-1}
            title="Inline code"
            aria-label="Inline code"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("`", "`", "code");
            }}
            className={cn(BTN, "font-mono")}
          >
            {"<>"}
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Link"
            aria-label="Link"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("[", "](url)", "text");
            }}
            className={BTN}
          >
            🔗
          </button>
        </div>
      </div>
    </div>
  );
}

function AddLetterMenu({
  pending,
  onPick,
}: {
  pending: boolean;
  onPick: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);

  if (pending) {
    return (
      <button type="button" disabled className={MUTED_ADD_BTN}>
        <Spinner />
        Working…
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={MUTED_ADD_BTN}
      >
        + Inspection Letter
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => {
            setOpen(false);
            onPick(n);
          }}
          className={MUTED_ADD_BTN}
        >
          + {n === 1 ? "Letter" : `${n} Letters`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancel"
        title="Cancel"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Letter group pill: [icon][abbr][sequence] with a border in the storyline
 * color. Use anywhere we display a letter group id like "U2".
 */
function LetterGroupPill({
  storyline,
  sequence,
  className,
}: {
  storyline: Pick<Storyline, "abbreviation" | "color_hex"> | undefined;
  sequence: number;
  className?: string;
}) {
  const abbr = storyline?.abbreviation ?? "?";
  const color = storyline?.color_hex ?? "#888888";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border-[1.5px] bg-card px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{ borderColor: color }}
    >
      <Mails size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">
        {abbr}
        {sequence}
      </span>
    </span>
  );
}

/**
 * Storyline pill: a filled circle on the left (storyline icon over the
 * storyline color) visually overlapping a bordered pill on the right
 * (storyline name in white, border in the storyline color). Meant for
 * the storylines list panel and breadcrumbs.
 */
function StorylinePill({
  storyline,
  className,
}: {
  storyline: Pick<
    Storyline,
    "name" | "abbreviation" | "color_hex" | "icon_type" | "icon_value"
  >;
  className?: string;
}) {
  const color = storyline.color_hex;
  const fg = readableOnHex(color);
  return (
    <span
      className={cn(
        "relative inline-flex h-6 items-center",
        className
      )}
    >
      {/* Pill body. Left padding reserves room for the icon square that
          overlaps the left cap. */}
      <span
        className="inline-flex h-6 min-w-0 items-center rounded-md border-[1.5px] bg-card pl-7 pr-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white"
        style={{ borderColor: color }}
      >
        <span className="truncate">{storyline.name}</span>
      </span>
      {/* Rounded-square icon tile (storyline icon over fill). Matches the
          pill's corner radius so the left cap reads as one shape. */}
      <span
        aria-hidden
        className="absolute left-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md"
        style={{ background: color, color: fg }}
      >
        {storyline.icon_value ? (
          <IconDisplay
            type={storyline.icon_type}
            value={storyline.icon_value}
            size={12}
          />
        ) : (
          <span className="font-mono text-[10px] font-semibold">
            {storyline.abbreviation}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * Report segment pill: [megaphone][report_id] with the storyline color as
 * a stroke/border and the fill being card grey tinted slightly toward the
 * storyline color. Use alongside LetterGroupPill / InspectionLetterPill.
 */
function ReportSegmentPill({
  storyline,
  reportId,
  className,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  reportId: string;
  className?: string;
}) {
  const color = storyline?.color_hex ?? "#888888";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 40%, var(--card))`,
      }}
    >
      <Megaphone size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">{reportId}</span>
    </span>
  );
}

/**
 * Inspection letter pill: [icon][content_id] filled with the storyline
 * color. Use wherever we display an inspection letter id like "L-U2/a".
 */
function InspectionLetterPill({
  storyline,
  contentId,
  className,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  contentId: string;
  className?: string;
}) {
  const color = storyline?.color_hex ?? "#888888";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{ background: color }}
    >
      <MailOpen size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">{contentId}</span>
    </span>
  );
}

/**
 * Action pill: rounded rectangle filled with the action's color, showing
 * the action icon and name. Icon + text adopt the same foreground color
 * the action icon uses on the actions tab (readable on the action color).
 */
function ActionPill({
  name,
  iconType,
  iconValue,
  colorHex,
  iconOnly,
  className,
}: {
  name: string;
  iconType: IconType;
  iconValue: string | null;
  colorHex: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const fg = readableOnHex(colorHex);
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent font-mono text-[11px] font-normal normal-case leading-none tracking-normal",
        iconOnly ? "w-6 justify-center px-0" : "px-1.5",
        className
      )}
      style={{ background: colorHex, color: fg }}
      title={iconOnly ? name : undefined}
      aria-label={iconOnly ? name : undefined}
    >
      {iconValue ? (
        <IconDisplay
          type={iconType}
          value={iconValue}
          size={11}
          className="shrink-0"
        />
      ) : null}
      {iconOnly ? null : <span className="whitespace-nowrap">{name}</span>}
    </span>
  );
}

function readableOnHex(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/**
 * Impact-tile wrapper that adds two layers of collab chrome around the
 * stock ImpactTile / NationImpactTile:
 *
 * - **Focus ring** via `<FieldHighlight>` so a peer focusing this tile shows
 *   their color around it. The `data-focus-field` attribute stamped by
 *   FieldHighlight is what `ActionEditor.handleEnterFocus` reads to derive
 *   the column key from the bubbled focus event — no need to wire explicit
 *   onFocus handlers into the underlying button/input.
 * - **Remote-change flash** — when the `value` prop changes more than
 *   ~250ms after the user's last click on this tile's own +/- (or any
 *   typing), the wrapper assumes the change came from a peer and pulses a
 *   yellow inset ring for ~600ms. Local clicks set `lastLocalChangeAtRef`
 *   right before calling `onChange`, so they're correctly suppressed.
 */
function HighlightableImpactTile({
  peers,
  focusKey,
  value,
  onChange,
  children,
}: {
  peers: PresencePeer[];
  focusKey: PresenceFocus;
  value: number;
  onChange: (v: number) => void;
  children: (value: number, onChange: (v: number) => void) => React.ReactNode;
}) {
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const lastLocalChangeAtRef = useRef(0);
  const prevValueRef = useRef(value);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevValueRef.current = value;
      return;
    }
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    const sinceLocal = Date.now() - lastLocalChangeAtRef.current;
    if (sinceLocal < 250) return;
    // Prefer the peer who currently has focus on this tile (almost always
    // the same peer who just clicked +/-); fall back to white so the
    // change is still visible if focus has already moved away.
    const focused = peers.find(
      (p) =>
        p.focus &&
        p.focus.table === focusKey.table &&
        p.focus.recordId === focusKey.recordId &&
        p.focus.field === focusKey.field
    );
    setFlashColor(focused?.color ?? "#ffffff");
    const t = setTimeout(() => setFlashColor(null), 600);
    return () => clearTimeout(t);
    // peers / focusKey fields intentionally omitted from deps — we only
    // want this effect to re-run on value change. The latest peers from
    // the value-change render is captured in the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(v: number) {
    lastLocalChangeAtRef.current = Date.now();
    onChange(v);
  }

  // While flashing, suppress FieldHighlight's own ring (passing focusKey=null)
  // so the flash is the single visible indicator. Otherwise the outer
  // FieldHighlight ring + the inner flash ring rendered concentrically as a
  // distinctive "double ring" — same color but at two radii.
  return (
    <FieldHighlight
      peers={peers}
      focusKey={flashColor ? null : focusKey}
      className="rounded-md p-0.5 transition-shadow"
    >
      <div
        className="rounded-md transition-shadow"
        style={
          flashColor
            ? { boxShadow: `0 0 0 2px ${flashColor}` }
            : undefined
        }
      >
        {children(value, handleChange)}
      </div>
    </FieldHighlight>
  );
}

function ActionEditor({
  action,
  templates,
  nations,
  segments,
  storyline,
  nextGroup,
  nextGroupLetters,
  groupId,
  days,
  currentLetterDayId,
  endingVariables,
  endingValues,
  onChange,
  onDelete,
  onOpenSegment,
  segmentOpen,
  onOpenLetter,
  letterOpen,
}: {
  action: ActionState;
  templates: ActionTemplate[];
  nations: Nation[];
  segments: ReportSegmentView[];
  storyline: Storyline | undefined;
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
  groupId: string;
  days: Day[];
  currentLetterDayId: string | null;
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
  onChange: (patch: Partial<ActionState>) => void;
  onDelete: () => void;
  onOpenSegment: () => void;
  segmentOpen: boolean;
  onOpenLetter: () => void;
  letterOpen: boolean;
}) {
  const [creatingLetter, startCreateLetter] = useTransition();
  const [creatingSegment, startCreateSegment] = useTransition();
  const { peers, setFocus } = usePresenceContext();
  const nextLetterFocus: PresenceFocus = {
    table: "actions",
    recordId: action.id,
    field: "next_letter_variant",
  };
  const segmentFocus: PresenceFocus = {
    table: "actions",
    recordId: action.id,
    field: "report_segment_id",
  };

  // Resolve "which sub-field just got focus" by walking up from `e.target`
  // to the nearest `[data-focus-field]` marker (stamped by FieldHighlight).
  // Falls back to a generic "editing" field so peers still see the action is
  // active even for sub-fields we haven't instrumented (impact tiles, ending
  // selects). On focus leaving the entire action (`relatedTarget` outside
  // the wrapper), clear focus.
  function handleEnterFocus(e: React.FocusEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const fieldEl = target.closest("[data-focus-field]");
    const field =
      fieldEl?.getAttribute("data-focus-field") || "editing";
    setFocus({ table: "actions", recordId: action.id, field });
  }
  function handleLeaveFocus(e: React.FocusEvent<HTMLDivElement>) {
    const wrapper = e.currentTarget;
    const stayingWithin = wrapper.contains(e.relatedTarget as Node | null);
    if (!stayingWithin) setFocus(null);
  }

  const currentDay = currentLetterDayId
    ? days.find((d) => d.id === currentLetterDayId) ?? null
    : null;
  const nextDay = currentDay
    ? days.find((d) => d.number > currentDay.number) ?? null
    : null;
  const tpl = action.action_template_id
    ? templates.find((t) => t.id === action.action_template_id)
    : undefined;
  const name = tpl?.name ?? action.name;
  const iconType = tpl?.icon_type ?? action.icon_type;
  const iconValue = tpl?.icon_value ?? action.icon_value;
  const colorHex = tpl?.color_hex ?? action.color_hex;

  const orderedNations = nations
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((n) => NATION_IMPACT_KEYS[n.name.toLowerCase()]);

  const nextLetterMatch =
    action.next_letter_variant
      ? nextGroupLetters.find((l) => l.variant === action.next_letter_variant) ?? null
      : null;
  const nextLetterSummary =
    action.next_letter_variant && nextLetterMatch?.summary
      ? nextLetterMatch.summary
      : "";
  const reportSegment = action.report_segment_id
    ? segments.find((s) => s.id === action.report_segment_id) ?? null
    : null;
  const reportSummary = reportSegment?.summary ?? "";

  const nextLetterPill =
    action.next_letter_variant && storyline ? (
      nextLetterMatch ? (
        <InspectionLetterPill
          storyline={storyline}
          contentId={nextLetterMatch.content_id}
        />
      ) : (
        // Broken / orphaned ref — the variant the action points at no
        // longer exists in the next group (likely the target letter was
        // deleted before delete-cascade cleanup landed). Surface as a
        // destructive-tinted pill so the user can re-pick or clear it.
        <span
          className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-destructive bg-destructive/15 px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-destructive"
          title="This action's next-letter target no longer exists. Pick a new one or set to (Unset)."
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          <span className="whitespace-nowrap">
            {action.next_letter_variant} (missing)
          </span>
        </span>
      )
    ) : null;

  const nextLetterItems: PillSelectItem[] = [
    ...(nextGroup
      ? nextGroupLetters.map<PillSelectItem>((l) => ({
          key: l.id,
          active:
            !!l.variant && action.next_letter_variant === l.variant,
          label: (
            <>
              <InspectionLetterPill
                storyline={storyline}
                contentId={l.content_id}
              />
              {l.summary ? (
                <span className="truncate text-muted-foreground">
                  {l.summary.slice(0, 24)}
                </span>
              ) : null}
            </>
          ),
          onPick: () => {
            if (l.variant) {
              onChange({ next_letter_variant: l.variant });
              return;
            }
            // The next letter has no variant (single-letter group).
            // Promote it to 'a' so the action can reference it stably.
            startCreateLetter(async () => {
              const { variant } = await ensureInspectionLetterVariant(l.id);
              onChange({ next_letter_variant: variant });
            });
          },
        }))
      : []),
    nextGroup
      ? {
          key: "__new_letter",
          muted: true,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <MailOpen size={13} aria-hidden />
              Add Letter
            </span>
          ),
          onPick: () =>
            startCreateLetter(async () => {
              const { variant } = await createLetterInNextGroup(groupId);
              onChange({ next_letter_variant: variant });
            }),
        }
      : {
          key: "__new_group_and_letter",
          muted: true,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Mails size={13} aria-hidden />
              Add Letter Group + Letter
            </span>
          ),
          onPick: () =>
            startCreateLetter(async () => {
              const { variant } =
                await createNextLetterGroupAndLetter(groupId);
              onChange({ next_letter_variant: variant });
            }),
        },
    {
      key: "__unset",
      divider: true,
      label: (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <MailXIcon size={13} />
          Clear Next Letter
        </span>
      ),
      active: !action.next_letter_variant,
      onPick: () => onChange({ next_letter_variant: null }),
    },
  ];

  const reportPill = reportSegment ? (
    <ReportSegmentPill
      storyline={storyline}
      reportId={reportSegment.report_id}
    />
  ) : null;

  const reportItems: PillSelectItem[] = [
    ...segments.map<PillSelectItem>((s) => ({
      key: s.id,
      active: action.report_segment_id === s.id,
      label: (
        <ReportSegmentPill storyline={storyline} reportId={s.report_id} />
      ),
      onPick: () => onChange({ report_segment_id: s.id }),
    })),
    {
      key: "__new_segment",
      muted: true,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Megaphone size={13} aria-hidden />
          Add Report Segment
        </span>
      ),
      onPick: () =>
        startCreateSegment(async () => {
          if (currentDay && !nextDay) {
            const { segmentId } = await createNextDayAndReportSegment(
              groupId,
              currentDay.number
            );
            onChange({ report_segment_id: segmentId });
          } else {
            const { segmentId } = await createReportSegmentForGroup(
              groupId,
              nextDay?.id ?? null
            );
            onChange({ report_segment_id: segmentId });
          }
        }),
    },
    {
      key: "__unset",
      divider: true,
      label: (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <SpeakerphoneXIcon size={13} />
          Clear Linked Report
        </span>
      ),
      active: !action.report_segment_id,
      onPick: () => onChange({ report_segment_id: null }),
    },
  ];

  return (
    <div
      className="@container relative rounded-md border border-border bg-black/20 p-3"
      onFocus={handleEnterFocus}
      onBlur={handleLeaveFocus}
    >
      {/* Header row: icon + name. The kebab is rendered LAST in the card
          (absolutely positioned top-right) so it is the final tab stop
          of the row before Tab moves to the next action. `pr-7` keeps
          the name clear of the absolute kebab. */}
      <div className="mb-2 flex items-center gap-2 pr-7">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
          style={{ background: colorHex, color: readableOnHex(colorHex) }}
        >
          {iconValue ? (
            <IconDisplay type={iconType} value={iconValue} size={16} />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
      </div>

      {/* Two-column body: left = Report then Next letter (with summaries),
          right = impacts + variables. Falls back to a single column on
          narrow surfaces (e.g. the graph's forceNarrow embed) via the
          card's @container query. */}
      <div className="grid grid-cols-1 gap-3 @[360px]:grid-cols-[2fr_3fr]">
        {/* LEFT column */}
        <div className="flex min-w-0 flex-col gap-3">
          <LinkField
            label="Report"
            pill={reportPill}
            pillNavigates={!!action.report_segment_id}
            navAriaLabel="Open report segment"
            onPillClick={onOpenSegment}
            pillActive={segmentOpen}
            items={reportItems}
            chevronAriaLabel="Pick report segment"
            summary={reportSummary}
            focusKey={segmentFocus}
            peers={peers}
            creating={creatingSegment}
          />
          <LinkField
            label="Next letter"
            pill={nextLetterPill}
            pillNavigates={
              !!action.next_letter_variant && !!nextLetterMatch
            }
            navAriaLabel="Open next letter"
            onPillClick={onOpenLetter}
            pillActive={letterOpen}
            items={nextLetterItems}
            chevronAriaLabel="Pick next letter"
            summary={nextLetterSummary}
            focusKey={nextLetterFocus}
            peers={peers}
            creating={creatingLetter}
          />
        </div>

        {/* RIGHT column */}
        <div className="flex min-w-0 flex-col gap-3">
          <ImpactBlock
            action={action}
            actionId={action.id}
            orderedNations={orderedNations}
            onChange={onChange}
            peers={peers}
          />
          <EndingAssignmentsSection
            actionId={action.id}
            peers={peers}
            assignments={action.ending_assignments}
            variables={endingVariables}
            values={endingValues}
            onChange={(next) => onChange({ ending_assignments: next })}
          />
        </div>
      </div>

      {/* Kebab is the card's last DOM child → the last tab stop in the
          row. Positioned to sit visually in the header's top-right. */}
      <div className="absolute right-3 top-3">
        <OverflowMenu
          items={[
            {
              label: "Delete Action",
              intent: "destructive",
              icon: <Trash2 size={12} aria-hidden />,
              onClick: onDelete,
            },
          ]}
        />
      </div>
    </div>
  );
}

/** A "Next letter" / "Report" field row inside ActionRow.
 *
 *  Visually one dropdown control (matching the styling of the delivery-
 *  override <DaySelect>): a bordered shell with a chevron on the right.
 *  Inside the shell are two click regions:
 *    - Pill area (left, flex-1): navigates to the linked record on click.
 *    - Chevron area (right): opens the picker dropdown to change the
 *      selection. Dropdown items are still rendered as pills.
 *  When `creating` is true, the row collapses to the existing
 *  <CreatingPill /> placeholder while a server-action runs. */
function LinkField({
  label,
  pill,
  pillNavigates,
  navAriaLabel,
  onPillClick,
  pillActive,
  items,
  chevronAriaLabel,
  summary,
  focusKey,
  peers,
  creating,
}: {
  label: string;
  pill: React.ReactNode | null;
  pillNavigates: boolean;
  navAriaLabel: string;
  onPillClick: () => void;
  pillActive: boolean;
  items: PillSelectItem[];
  chevronAriaLabel: string;
  summary: string;
  focusKey: PresenceFocus;
  peers: PresencePeer[];
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Highlighted option index for keyboard navigation. -1 = nothing
  // highlighted (mouse mode). Arrow keys move it; Enter commits it.
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  // Keep the highlighted option scrolled into view as arrows move it.
  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelectorAll("[role='option']")[
      activeIndex
    ] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openMenu() {
    // Highlight the currently-active item (or the first) so Enter has a
    // sensible target the moment the menu opens.
    const activeAt = items.findIndex((it) => it.active);
    setActiveIndex(activeAt >= 0 ? activeAt : 0);
    setOpen(true);
  }
  function commitAt(idx: number) {
    const item = items[idx];
    if (!item) return;
    item.onPick();
    setOpen(false);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commitAt(activeIndex);
    }
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <div className="flex h-8 w-full items-center">
        {creating ? (
          <CreatingPill />
        ) : (
          <FieldHighlight
            peers={peers}
            focusKey={focusKey}
            className="w-full"
          >
            <div ref={ref} className="relative w-full">
              {/* Outer shell: clicking ANYWHERE except the pill opens
                   the dropdown. The pill is a nested button (with
                   stopPropagation) that navigates to the linked record.
                   Implemented as a <div role="button"> so we can have a
                   nested <button> for the pill — HTML disallows nested
                   <button>s. Height + bg match the delivery-override
                   <DaySelect> on the letter detail panel. The shell is
                   the single tab stop; menu options are reached with
                   arrows + Enter, not Tab. */}
              <div
                role="button"
                tabIndex={0}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={chevronAriaLabel}
                onClick={() => (open ? setOpen(false) : openMenu())}
                onKeyDown={handleKeyDown}
                className="flex h-8 w-full cursor-pointer items-center overflow-hidden rounded-md bg-black/35 transition-colors hover:bg-black/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/60"
              >
                <span className="flex min-w-0 flex-1 items-center pl-3 pr-1.5">
                  {pill ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (pillNavigates) onPillClick();
                      }}
                      aria-label={navAriaLabel}
                      title={navAriaLabel}
                      disabled={!pillNavigates}
                      className={cn(
                        "inline-flex min-w-0 items-center rounded-md focus:outline-none",
                        // When the linked record is open in another
                        // panel, ring the pill itself (not the shell).
                        pillActive && "ring-2 ring-foreground/60",
                        pillNavigates && !pillActive
                          ? "cursor-pointer hover:ring-1 hover:ring-foreground/30"
                          : pillNavigates
                            ? "cursor-pointer"
                            : "cursor-default"
                      )}
                    >
                      {pill}
                    </button>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground/60">
                      —
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center pl-1 pr-2 transition-colors",
                    open
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                  aria-hidden
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
              {open ? (
                <div
                  ref={listRef}
                  role="listbox"
                  className="absolute left-0 top-full z-20 mt-1 min-w-full max-h-64 overflow-auto rounded-md border border-border bg-card shadow-md"
                >
                  {items.map((item, idx) => (
                    <div key={item.key}>
                      {item.divider ? (
                        <div className="my-1 border-t border-border" />
                      ) : null}
                      <button
                        type="button"
                        tabIndex={-1}
                        role="option"
                        aria-selected={!!item.active}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => {
                          item.onPick();
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs focus:outline-none",
                          idx === activeIndex && "bg-accent/60",
                          item.active && idx !== activeIndex && "bg-accent/30",
                          item.muted && "text-muted-foreground"
                        )}
                      >
                        {item.label}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </FieldHighlight>
        )}
      </div>
      <p className="mt-0.5 min-h-[2lh] text-[10px] italic leading-snug text-muted-foreground/60">
        {summary}
      </p>
    </div>
  );
}

/** Impact tiles, regrouped per Figma: top row holds two sub-boxes —
 *  world impacts (demerits + world status) on the left and class
 *  affinities (working + gentry) on the right — and the bottom row is
 *  the five nation tiles full-width. Tile components and the underlying
 *  action columns are unchanged; only the wrappers differ from the
 *  previous layout. */
function ImpactBlock({
  action,
  actionId,
  orderedNations,
  onChange,
  peers,
}: {
  action: ActionState;
  actionId: string;
  orderedNations: Nation[];
  onChange: (patch: Partial<ActionState>) => void;
  peers: PresencePeer[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Impact
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
          <HighlightableImpactTile
            peers={peers}
            focusKey={{
              table: "actions",
              recordId: actionId,
              field: "impact_demerits",
            }}
            value={action.impact_demerits}
            onChange={(v) =>
              onChange({ impact_demerits: v } as Partial<ActionState>)
            }
          >
            {(value, handleChange) => (
              <ImpactTile
                label="Demerits"
                icon={
                  <IconCircleMinus
                    size={14}
                    aria-hidden
                    className="text-red-500"
                  />
                }
                value={value}
                onChange={handleChange}
              />
            )}
          </HighlightableImpactTile>
          <HighlightableImpactTile
            peers={peers}
            focusKey={{
              table: "actions",
              recordId: actionId,
              field: "impact_world_status",
            }}
            value={action.impact_world_status}
            onChange={(v) =>
              onChange({ impact_world_status: v } as Partial<ActionState>)
            }
          >
            {(value, handleChange) => (
              <ImpactTile
                label="World Status"
                icon={
                  <IconWorldBolt
                    size={14}
                    aria-hidden
                    className="text-cyan-400"
                  />
                }
                value={value}
                onChange={handleChange}
              />
            )}
          </HighlightableImpactTile>
        </div>
        <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
          {CLASS_AFFINITY.map((c) => (
            <HighlightableImpactTile
              key={c.key}
              peers={peers}
              focusKey={{
                table: "actions",
                recordId: actionId,
                field: c.key,
              }}
              value={action[c.key]}
              onChange={(v) =>
                onChange({ [c.key]: v } as Partial<ActionState>)
              }
            >
              {(value, handleChange) => (
                <ImpactTile
                  label={c.label}
                  icon={c.icon}
                  value={value}
                  onChange={handleChange}
                />
              )}
            </HighlightableImpactTile>
          ))}
        </div>
      </div>
      <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
        {orderedNations.map((n) => {
          const key = NATION_IMPACT_KEYS[n.name.toLowerCase()];
          return (
            <HighlightableImpactTile
              key={n.id}
              peers={peers}
              focusKey={{
                table: "actions",
                recordId: actionId,
                field: key,
              }}
              value={action[key]}
              onChange={(v) =>
                onChange({ [key]: v } as Partial<ActionState>)
              }
            >
              {(value, handleChange) => (
                <NationImpactTile
                  nation={n}
                  value={value}
                  onChange={handleChange}
                />
              )}
            </HighlightableImpactTile>
          );
        })}
      </div>
    </div>
  );
}

function EndingAssignmentsSection({
  actionId,
  peers,
  assignments,
  variables,
  values,
  onChange,
}: {
  actionId: string;
  peers: PresencePeer[];
  assignments: EndingAssignmentState[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  onChange: (next: EndingAssignmentState[]) => void;
}) {
  // Variable is locked-in at insert time — to switch which variable an
  // action drives, delete the row and add a new one. Removes the entire
  // class of "picker-open with no variable yet" intermediate state, which
  // used to require a separate pending list and led to the dropdown
  // disappearing on reconciliation.
  function setValue(idx: number, valueId: string | null) {
    const next = assignments.slice();
    next[idx] = { ...next[idx], value_id: valueId };
    onChange(next);
  }
  function removeAt(idx: number) {
    const next = assignments.slice();
    next.splice(idx, 1);
    onChange(next);
  }
  function addWithVariable(variableId: string) {
    onChange([
      ...assignments,
      { variable_id: variableId, value_id: null },
    ]);
  }

  const chosenVariableIds = new Set(
    assignments.map((a) => a.variable_id).filter(Boolean)
  );

  const availableVariables = variables.filter(
    (v) => !chosenVariableIds.has(v.id)
  );

  const variableById = new Map(variables.map((v) => [v.id, v]));

  // Width (in monospace `ch`) of the longest assigned variable name —
  // every chip's name segment is set to this so the name|value dividers
  // line up vertically across stacked chips.
  const nameColCh = assignments.reduce((max, a) => {
    const n = variableById.get(a.variable_id)?.name.length ?? 0;
    return Math.max(max, n);
  }, 1);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Variables
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        {/* No overflow-hidden here — it would clip the 2px outset
            FieldHighlight ring drawn around a focused chip. Each chip
            already clips its own text via its inner overflow-hidden. */}
        <div className="flex min-w-0 flex-col items-stretch gap-1">
          {assignments.map((a, idx) => {
            const variable = variableById.get(a.variable_id);
            const valuesForVar = values.filter(
              (v) => v.variable_id === a.variable_id
            );
            return (
              <ActionVariableChip
                key={`saved-${idx}`}
                variable={variable}
                valuesForVar={valuesForVar}
                valueId={a.value_id}
                nameColCh={nameColCh}
                onValueChange={(v) => setValue(idx, v)}
                onRemove={() => removeAt(idx)}
                focusKey={{
                  table: "actions",
                  recordId: actionId,
                  field: `ending_val_${idx}`,
                }}
                peers={peers}
              />
            );
          })}
        </div>
        <AddEndingVariableMenu
          variables={availableVariables}
          onPick={addWithVariable}
          disabled={variables.length === 0 || availableVariables.length === 0}
          disabledReason={
            variables.length === 0
              ? "Create an ending variable first"
              : availableVariables.length === 0
                ? "All variables are already assigned"
                : undefined
          }
        />
      </div>
    </div>
  );
}

/** Compact pill that mirrors the endings tab's ChipPill look without
 *  inheriting its operator/multi-kind shape. Left segment: variable name
 *  on the variable's color (locked — variable can't be swapped, only the
 *  row can be deleted). Right segment: value + chevron, with an invisible
 *  native `<select>` overlay that opens on click anywhere in the cell.
 *  Hovering reveals an "×" to remove the entire assignment. */
function ActionVariableChip({
  variable,
  valuesForVar,
  valueId,
  nameColCh,
  onValueChange,
  onRemove,
  focusKey,
  peers,
}: {
  variable: EndingVariable | undefined;
  valuesForVar: EndingVariableValue[];
  valueId: string | null;
  /** Width of the name segment, in monospace `ch`, shared by every chip
   *  in the section so the name|value dividers align vertically. */
  nameColCh: number;
  onValueChange: (id: string | null) => void;
  onRemove: () => void;
  focusKey: PresenceFocus;
  peers: PresencePeer[];
}) {
  if (!variable) {
    // Variable was deleted upstream — render a destructive-tinted
    // placeholder so the row is still removable.
    return (
      <span className="flex h-5 w-full items-center justify-between gap-1 rounded-md border border-destructive bg-destructive/15 px-1.5 font-mono text-[10px] uppercase text-destructive">
        <span className="truncate">unknown variable</span>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Remove ending assignment"
          title="Remove"
          onClick={onRemove}
          className="-mr-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm hover:bg-destructive/30"
        >
          ×
        </button>
      </span>
    );
  }
  const color = variable.color_hex ?? paletteColor(variable.color_index);
  const valueLabel =
    valuesForVar.find((v) => v.id === valueId)?.value ?? "—";
  return (
    <FieldHighlight peers={peers} focusKey={focusKey}>
      <span
        className="group flex h-5 w-full items-stretch overflow-hidden whitespace-nowrap rounded-md border font-mono text-[10px] uppercase leading-[16px]"
        style={{ borderColor: color }}
        title={`${variable.name} = ${valueLabel}`}
      >
        {/* Left: variable name, on color (locked). Fixed width (shared
            across chips) so the name|value divider aligns vertically;
            the name is right-aligned so it sits against the divider. */}
        <span
          className="flex shrink-0 items-center justify-end px-1.5"
          style={{
            backgroundColor: color,
            color: readableOnHex(color),
            width: `calc(${nameColCh}ch + 0.75rem)`,
          }}
        >
          <span className="truncate text-right">{variable.name}</span>
        </span>
        {/* Right: value + chevron + invisible overlay select. Fills the
            remaining width and truncates when narrow. */}
        <span className="relative flex min-w-0 flex-1 items-center gap-1 px-1.5 text-white">
          <span aria-hidden className="min-w-0 flex-1 truncate">
            {valueLabel}
          </span>
          <ChevronDown
            size={10}
            aria-hidden
            className="shrink-0 opacity-60"
          />
          <select
            value={valueId ?? ""}
            onChange={(e) => {
              onValueChange(e.target.value || null);
              e.target.blur();
            }}
            aria-label={`${variable.name} value`}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">—</option>
            {valuesForVar.map((v) => (
              <option key={v.id} value={v.id}>
                {v.value}
              </option>
            ))}
          </select>
        </span>
        {/* Remove (hover-only, mouse-only — not a tab stop). */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Remove ending assignment"
          title="Remove"
          onClick={onRemove}
          className="hidden shrink-0 items-center px-1 text-muted-foreground transition-colors group-hover:inline-flex hover:text-destructive"
        >
          ×
        </button>
      </span>
    </FieldHighlight>
  );
}

/**
 * "+ Ending" button that opens a list of unassigned variables. Picking one
 * inserts a new ending assignment row already bound to that variable —
 * there's no intermediate "row exists but no variable picked yet" state,
 * which the previous flow allowed and which let the realtime patch path
 * silently drop unbound rows.
 */
function AddEndingVariableMenu({
  variables,
  onPick,
  disabled,
  disabledReason,
}: {
  variables: EndingVariable[];
  onPick: (variableId: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  // Keyboard-highlighted option; -1 = mouse mode. Menu options are not
  // tab stops — arrows move this, Enter commits.
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelectorAll("[role='option']")[
      activeIndex
    ] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openMenu() {
    if (disabled) return;
    setActiveIndex(0);
    setOpen(true);
  }
  function commitAt(idx: number) {
    const v = variables[idx];
    if (!v) return;
    onPick(v.id);
    setOpen(false);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % variables.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(
        (i) => (i - 1 + variables.length) % variables.length
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(variables.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commitAt(activeIndex);
    }
  }
  return (
    <div ref={ref} className="relative inline-flex">
      {/* Trigger matches the frameworks "+ block" InsertionZone button. */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Add ending variable"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        title={disabledReason ?? "Add ending variable"}
        className={cn(
          "inline-flex h-5 w-10 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors duration-300 ease-out",
          disabled
            ? "border-border/30 text-muted-foreground/40"
            : "border-border hover:border-solid hover:bg-white/10 hover:text-foreground"
        )}
      >
        <Plus size={12} aria-hidden />
      </button>
      {open && variables.length > 0 ? (
        <div
          ref={listRef}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 min-w-[180px] max-h-64 overflow-auto rounded-md border border-border bg-card shadow-md"
        >
          {variables.map((v, idx) => {
            const color = v.color_hex ?? paletteColor(v.color_index);
            return (
              <button
                key={v.id}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onPick(v.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs focus:outline-none",
                  idx === activeIndex && "bg-accent/60"
                )}
                style={{ color }}
              >
                {v.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function BackLink({
  onNavigate,
  label = "Back to inspection letters",
}: {
  onNavigate: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

function DeleteX({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** One entry in the add-action menu — either a single template or a
 *  paired set of two. `templates` is ordered by sort_order; the first
 *  element's id is the canonical id used when adding the whole entry. */
type ActionPickerEntry = {
  id: string;
  label: string;
  templates: ActionTemplate[];
};

/**
 * Deduplicate paired templates into single picker entries. A paired
 * entry carries both templates (sort_order order) and is labeled "A + B";
 * the lower-sort_order template acts as the canonical id for the pair.
 * `addActionFromTemplate` handles pair insertion server-side.
 */
function pickerEntries(templates: ActionTemplate[]): ActionPickerEntry[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const entries: ActionPickerEntry[] = [];
  for (const t of templates) {
    if (seen.has(t.id)) continue;
    const partner = t.paired_template_id
      ? byId.get(t.paired_template_id)
      : undefined;
    if (partner) {
      const [a, b] =
        t.sort_order <= partner.sort_order ? [t, partner] : [partner, t];
      entries.push({
        id: a.id,
        label: `${a.name} + ${b.name}`,
        templates: [a, b],
      });
      seen.add(a.id);
      seen.add(b.id);
    } else {
      entries.push({ id: t.id, label: t.name, templates: [t] });
      seen.add(t.id);
    }
  }
  return entries;
}

/** Small icon swatch used in the add-action menu — a template's icon on
 *  its own color, falling back to a flag-bolt when the template has no
 *  icon set. */
function ActionTemplateSwatch({
  template,
  size = 16,
}: {
  template: ActionTemplate;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded"
      style={{
        width: size,
        height: size,
        background: template.color_hex,
        color: readableOnHex(template.color_hex),
      }}
    >
      {template.icon_value ? (
        <IconDisplay
          type={template.icon_type}
          value={template.icon_value}
          size={Math.round(size * 0.62)}
        />
      ) : (
        <IconBolt size={Math.round(size * 0.62)} aria-hidden />
      )}
    </span>
  );
}

/**
 * "+" add-action menu. Trigger matches the frameworks "+ block" button.
 * Each menu row is an ActionPickerEntry: a single template, or a pair.
 * For a pair, both action icons render before the label, clicking the
 * row adds BOTH actions, and hovering reveals a flyout submenu listing
 * each action so the user can add just one.
 */
function AddActionMenu({
  templates,
  disabled,
  onAdd,
}: {
  templates: ActionTemplate[];
  disabled?: boolean;
  /** includePair=false adds just the one template even if it is paired. */
  onAdd: (templateId: string, includePair: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoverPairId, setHoverPairId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => pickerEntries(templates), [templates]);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
        setHoverPairId(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function add(templateId: string, includePair: boolean) {
    onAdd(templateId, includePair);
    setOpen(false);
    setHoverPairId(null);
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add action"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "inline-flex h-6 w-12 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors duration-300 ease-out",
          disabled
            ? "border-border/30 text-muted-foreground/40"
            : "border-border hover:border-solid hover:bg-white/10 hover:text-foreground"
        )}
      >
        <Plus size={14} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 z-30 mb-1 w-max -translate-x-1/2 overflow-visible rounded-md border border-border bg-popover shadow-md"
        >
          {entries.map((entry) => {
            const isPair = entry.templates.length === 2;
            return (
              <div
                key={entry.id}
                className="relative"
                onMouseEnter={() =>
                  setHoverPairId(isPair ? entry.id : null)
                }
                onMouseLeave={() => setHoverPairId(null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => add(entry.id, true)}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-accent/40"
                >
                  <span className="flex items-center gap-1">
                    {entry.templates.map((t) => (
                      <ActionTemplateSwatch key={t.id} template={t} />
                    ))}
                  </span>
                  <span className="flex-1">{entry.label}</span>
                  {isPair ? (
                    <ChevronRight
                      size={12}
                      aria-hidden
                      className="text-muted-foreground"
                    />
                  ) : null}
                </button>
                {isPair && hoverPairId === entry.id ? (
                  <div
                    role="menu"
                    /* Anchored to the item's bottom so the flyout grows
                       upward — the menu itself opens upward from a
                       bottom-of-panel "+", so a downward flyout would be
                       clipped by the panel-slide's overflow. */
                    className="absolute bottom-0 left-full z-40 ml-0.5 w-max overflow-hidden rounded-md border border-border bg-popover shadow-md"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => add(entry.id, true)}
                      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-accent/40"
                    >
                      <span className="flex items-center gap-1">
                        {entry.templates.map((t) => (
                          <ActionTemplateSwatch key={t.id} template={t} />
                        ))}
                      </span>
                      <span>Add both</span>
                    </button>
                    <div className="border-t border-border" />
                    {entry.templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="menuitem"
                        onClick={() => add(t.id, false)}
                        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-accent/40"
                      >
                        <ActionTemplateSwatch template={t} />
                        <span>{t.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reorder mode controls for a list section header. Locked: shows the
 * reorder icon (clicking enters reorder mode). Unlocked: shows
 * Saved/Unsaved + Save (when dirty) + Cancel — same pattern as panel
 * header SaveRevert but specific to drag-reorder.
 */
function ReorderControls({
  locked,
  dirty,
  pending,
  onUnlock,
  onCancel,
  onSave,
}: {
  locked: boolean;
  dirty: boolean;
  pending: boolean;
  onUnlock: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (locked) {
    return (
      <button
        type="button"
        onClick={onUnlock}
        title="Reorder"
        aria-label="Reorder"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ReorderIcon active={false} />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {dirty ? (
        <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
          • Unsaved
        </span>
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          Reordering
        </span>
      )}
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        aria-label="Cancel reorder"
        title="Cancel reorder"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {dirty ? (
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          aria-label="Save order"
          title="Save order"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Spinner />
          ) : (
            <Save size={14} aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}

function ReorderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={active ? "text-foreground" : undefined}
    >
      <path d="M7 4v16" />
      <path d="M4 7l3-3 3 3" />
      <path d="M17 4v16" />
      <path d="M14 17l3 3 3-3" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

/**
 * Day dropdown with a "+ Day" entry. `groupDefaultId` (optional) labels the
 * group-default day with "(Group Default)" inside the open dropdown list
 * only — the collapsed display shows the plain day name. Implemented as a
 * custom popover so the displayed label can differ from the list label.
 */
function DaySelect({
  value,
  days,
  groupDefaultId,
  hideClear,
  dashWhenGroupDefault,
  defaultSuffix,
  onChange,
  className,
}: {
  value: string;
  days: Day[];
  groupDefaultId?: string | null;
  /** When true, the "—" clear option is not rendered in the dropdown. */
  hideClear?: boolean;
  /** When true, the closed button shows "—" whenever value equals groupDefaultId. */
  dashWhenGroupDefault?: boolean;
  /** Appended in parens when value equals groupDefaultId, e.g. "(Following Day)". */
  defaultSuffix?: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [creating, startCreate] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = value ? days.find((d) => d.id === value) ?? null : null;
  const isGroupDefault =
    !!selected && !!groupDefaultId && selected.id === groupDefaultId;
  const displayText =
    selected && isGroupDefault && dashWhenGroupDefault
      ? "—"
      : selected
        ? `${selected.identifier}${selected.name ? ` — ${selected.name}` : ""}${
            isGroupDefault && defaultSuffix ? ` ${defaultSuffix}` : ""
          }`
        : "—";

  if (creating) {
    return (
      <span
        role="status"
        aria-label="Creating day"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-muted px-3 font-mono text-sm text-muted-foreground",
          className
        )}
      >
        <Spinner />
        Creating…
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-input px-3 text-left font-mono text-sm",
          className
        )}
      >
        <span className="truncate">{displayText}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-muted-foreground"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-md"
        >
          {!hideClear ? (
            <DayOption
              active={value === ""}
              onPick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              —
            </DayOption>
          ) : null}
          {days.map((d) => (
            <DayOption
              key={d.id}
              active={value === d.id}
              onPick={() => {
                onChange(d.id);
                setOpen(false);
              }}
            >
              {d.identifier}
              {d.name ? ` — ${d.name}` : ""}
              {groupDefaultId && d.id === groupDefaultId ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {defaultSuffix ?? "(Group Default)"}
                </span>
              ) : null}
            </DayOption>
          ))}
          <DayOption
            active={false}
            onPick={() => {
              setOpen(false);
              startCreate(async () => {
                const { newDayId } = await createNextDay();
                onChange(newDayId);
              });
            }}
          >
            <span className="text-muted-foreground">+ Day</span>
          </DayOption>
        </div>
      ) : null}
    </div>
  );
}

function DayOption({
  active,
  onPick,
  children,
}: {
  active: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-1 px-3 py-1.5 text-left font-mono text-sm hover:bg-accent/40",
        active && "bg-accent/30"
      )}
    >
      {children}
    </button>
  );
}

type PillSelectItem = {
  key: string;
  label: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  /** When true, a divider line is drawn above this item in the menu. */
  divider?: boolean;
  onPick: () => void;
};

/** Muted-outlined delete button used across all entity panels. */
function BreadcrumbLink({
  children,
  onClick,
  active,
  color,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  color?: string;
  icon?: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors";
  if (!onClick) {
    return (
      <span
        className={cn(
          base,
          active ? "bg-accent/40 text-foreground" : "text-muted-foreground"
        )}
        style={color ? { color } : undefined}
      >
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        active
          ? "bg-accent/40 text-foreground"
          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      )}
      style={color ? { color } : undefined}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Thin wrapper that makes a styled pill (LetterGroupPill,
 * InspectionLetterPill, ReportSegmentPill) act as a breadcrumb link.
 * Keeps the pill's intrinsic styling and just adds hover/focus states
 * and a muted ring when `active`.
 */
function BreadcrumbPill({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const ringClass = active
    ? "ring-2 ring-foreground/30 ring-offset-2 ring-offset-background rounded-md"
    : "";
  if (!onClick) {
    return (
      <span className={cn("inline-flex items-center", ringClass)}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md transition-opacity hover:opacity-80",
        ringClass
      )}
    >
      {children}
    </button>
  );
}

/**
 * Section header bar at the top of a panel card. Matches the style of
 * the inline list headers (e.g. "Letters (N)"). Uppercase mono label on
 * a full-width border-b row.
 */
function PanelHeader({
  title,
  icon,
  dirty,
  showSaved,
  saveRevert,
  menu,
}: {
  title: string;
  icon?: ReactNode;
  dirty?: boolean;
  showSaved?: boolean;
  /** Optional Save / Revert pair; renders between the dirty indicator
   *  and the overflow menu. Hidden when no SaveRevert is supplied. */
  saveRevert?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3 py-1.5">
      <span className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </span>
      <div className="flex items-center gap-2">
        {dirty ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
            • Unsaved
          </span>
        ) : showSaved ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            Saved
          </span>
        ) : null}
        {saveRevert}
        {menu}
      </div>
    </div>
  );
}

type OverflowMenuItem = {
  label: string;
  onClick?: () => void;
  intent?: "default" | "destructive";
  icon?: React.ReactNode;
  /** When provided, the item opens a nested submenu instead of firing
   * onClick. The submenu replaces the current items with a Back row at
   * the top. */
  submenu?: OverflowMenuItem[];
};

function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<number[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPath([]);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const currentItems = useMemo(() => {
    let cur: OverflowMenuItem[] = items;
    for (const idx of path) {
      const next = cur[idx]?.submenu;
      if (!next) break;
      cur = next;
    }
    return cur;
  }, [items, path]);
  const inSubmenu = path.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setPath([]);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <MoreVertical size={14} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-max max-w-[260px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          {inSubmenu ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="flex w-full items-center gap-2 whitespace-nowrap border-b border-border px-3 py-1 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <ChevronLeft size={11} aria-hidden />
              Back
            </button>
          ) : null}
          {currentItems.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => {
                if (item.submenu) {
                  setPath((p) => [...p, i]);
                  return;
                }
                item.onClick?.();
                setOpen(false);
                setPath([]);
              }}
              className={cn(
                "flex w-full items-center gap-2 whitespace-nowrap px-3 py-1 text-left font-mono text-[10px] transition-colors",
                item.intent === "destructive"
                  ? "text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  : "text-foreground hover:bg-accent/40"
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.submenu ? (
                <ChevronRight
                  size={11}
                  aria-hidden
                  className="text-muted-foreground"
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DeleteButton({
  onClick,
  disabled,
  label = "Delete",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground opacity-40 transition-[colors,opacity] hover:border-destructive hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 disabled:opacity-30"
    >
      <Trash2 size={10} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Shared style for "+ thing" buttons — muted at rest, solid accent on hover. */
const MUTED_ADD_BTN =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/40 px-3 text-xs text-muted-foreground/60 transition-colors hover:border-foreground/40 hover:bg-accent hover:text-accent-foreground disabled:opacity-40";


/**
 * Footer showing when and by whom a record was last updated. Renders nothing
 * if `at` is missing (i.e., the row predates the `updated_by` column).
 */
function LastUpdatedFooter({
  at,
  by,
}: {
  at: string | null | undefined;
  by: string | null | undefined;
}) {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const absolute = date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const relative = formatDistanceToNow(date, { addSuffix: true });
  return (
    <p
      title={absolute}
      className="mt-3 text-center text-[11px] text-muted-foreground/70"
    >
      Last updated {relative}
      {by ? (
        <>
          {" "}by <span className="font-mono">{by}</span>
        </>
      ) : null}
    </p>
  );
}

const ROMAN_RE = /^[ivxlcdm]+$/;
function formatRomanInput(raw: string): string {
  return raw.toLowerCase().replace(/[^ivxlcdm]/g, "");
}
function isValidRoman(v: string): boolean {
  return ROMAN_RE.test(v);
}

function CreatingPill() {
  return (
    <span
      role="status"
      aria-label="Creating"
      className="inline-flex h-7 w-28 items-center justify-center gap-1 rounded-md border border-border bg-muted px-1 text-[11px] text-muted-foreground"
    >
      <Spinner />
      Creating…
    </span>
  );
}

/**
 * Inline storyline editor that occupies slot 1 in place of the group panel.
 * Uses instant-save (useInstantField) — no dirty flag or SaveRevert button.
 */
function StorylineInspector({
  storyline,
  groups,
  allLetters,
  days,
  selectedGroupId,
  onBack,
  onSelectGroup,
  onCreateGroup,
  onDeselectGroup,
  onConfirmDialog,
}: {
  storyline: Storyline;
  groups: LetterGroup[];
  allLetters: InspectionLetterView[];
  days: Day[];
  selectedGroupId: string | null;
  onBack: () => void;
  onSelectGroup: (id: string) => void;
  /** Called after the inspector creates a new letter group. Receives the
   * full row so the parent can seed its local mirror before navigating —
   * prevents slot 2 from going blank while the RSC refetch is in flight. */
  onCreateGroup: (group: LetterGroup) => void;
  /** Called when the user clicks the currently-selected group row to toggle
   * it off. Should return the UI to storyline-only mode (inspector visible,
   * no group selected). */
  onDeselectGroup: () => void;
  onConfirmDialog: (options: {
    title: string;
    message?: string;
    confirmLabel?: string;
    intent?: "destructive" | "default";
  }) => Promise<boolean>;
}) {
  // Local mirror for display — kept so icon/color picker can update all
  // three fields simultaneously before the instant-save hooks see them.
  const [state, setState] = useState(() => ({
    name: storyline.name,
    abbreviation: storyline.abbreviation,
    description: storyline.description,
    icon_type: storyline.icon_type,
    icon_value: storyline.icon_value,
    color_hex: storyline.color_hex,
  }));
  const [, startRowAction] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Resync the local mirror when a different storyline is selected.
  // Instant-save hooks are remounted via key={storyline.id} at the call site,
  // so their debounce timers reset automatically.
  useEffect(() => {
    setState({
      name: storyline.name,
      abbreviation: storyline.abbreviation,
      description: storyline.description,
      icon_type: storyline.icon_type,
      icon_value: storyline.icon_value,
      color_hex: storyline.color_hex,
    });
    setPickerOpen(false);
  }, [storyline.id]);

  // Presence context — the parent WorkspacePresenceProvider is already wired.
  const { setFocus, peers, pingActivity } = usePresenceContext();

  // ----- Instant-save fields -----
  // value= uses the canonical server row (storyline.X), NOT state.X, to avoid
  // the B3 no-save bug (local mirror identical to valueRef → commit short-circuits).
  const nameField = useInstantField<string>({
    value: storyline.name,
    onCommit: async (next) => {
      await patchStoryline(storyline.id, { name: next });
    },
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "storylines", recordId: storyline.id, field: "name" }
          : null
      ),
    onActivity: pingActivity,
  });
  const abbrField = useInstantField<string>({
    value: storyline.abbreviation,
    onCommit: async (next) => {
      await patchStoryline(storyline.id, { abbreviation: next });
    },
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? {
              table: "storylines",
              recordId: storyline.id,
              field: "abbreviation",
            }
          : null
      ),
    onActivity: pingActivity,
  });
  const descriptionField = useInstantField<string | null>({
    value: storyline.description,
    onCommit: async (next) => {
      await patchStoryline(storyline.id, { description: next });
    },
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? {
              table: "storylines",
              recordId: storyline.id,
              field: "description",
            }
          : null
      ),
    onActivity: pingActivity,
  });
  // Icon + color are patched together (the picker emits all three at once).
  // We commit via a single patchStoryline call that carries all three fields.
  const iconColorField = useInstantField<{
    icon_type: string;
    icon_value: string | null;
    color_hex: string;
  }>({
    value: {
      icon_type: storyline.icon_type,
      icon_value: storyline.icon_value,
      color_hex: storyline.color_hex,
    },
    equals: (a, b) =>
      a.icon_type === b.icon_type &&
      a.icon_value === b.icon_value &&
      a.color_hex === b.color_hex,
    onCommit: async (next) => {
      await patchStoryline(storyline.id, {
        icon_type: next.icon_type as import("@/lib/db/enums").IconType,
        icon_value: next.icon_value,
        color_hex: next.color_hex,
      });
    },
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? {
              table: "storylines",
              recordId: storyline.id,
              field: "icon_color",
            }
          : null
      ),
    onActivity: pingActivity,
  });

  // Focus-key descriptors for FieldHighlight wrappers.
  const nameFocus: PresenceFocus = {
    table: "storylines",
    recordId: storyline.id,
    field: "name",
  };
  const abbrFocus: PresenceFocus = {
    table: "storylines",
    recordId: storyline.id,
    field: "abbreviation",
  };
  const descriptionFocus: PresenceFocus = {
    table: "storylines",
    recordId: storyline.id,
    field: "description",
  };
  const iconColorFocus: PresenceFocus = {
    table: "storylines",
    recordId: storyline.id,
    field: "icon_color",
  };

  function handleAddGroup() {
    startRowAction(async () => {
      const { group } = await createLetterGroupInStoryline(storyline.id);
      onCreateGroup(group);
    });
  }

  async function handleDeleteStoryline() {
    const ok = await onConfirmDialog({
      title: "Delete storyline?",
      message: `${storyline.name} will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("id", storyline.id);
      await deleteStoryline(fd);
      onBack();
    });
  }

  const letterCountByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of allLetters)
      m.set(l.letter_group_id, (m.get(l.letter_group_id) ?? 0) + 1);
    return m;
  }, [allLetters]);
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const sortedGroups = useMemo(
    () => groups.slice().sort((a, b) => a.sequence - b.sequence),
    [groups]
  );

  // --- Reorder mode for the letter-groups list ---
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [reorderPending, startReorder] = useTransition();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // If the server group set changes (e.g. a new group was added), reset the
  // pending order so stale IDs don't leak in.
  useEffect(() => {
    if (reorderMode) {
      setPendingOrder(sortedGroups.map((g) => g.id));
    } else {
      setPendingOrder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyline.id, reorderMode]);

  const viewOrderedGroups = useMemo(() => {
    if (!reorderMode || !pendingOrder) return sortedGroups;
    const byId = new Map(sortedGroups.map((g) => [g.id, g]));
    return pendingOrder
      .map((id) => byId.get(id))
      .filter((g): g is LetterGroup => !!g);
  }, [reorderMode, pendingOrder, sortedGroups]);

  /**
   * Returns the set of group ids whose delivery day is out of monotonic
   * order (earlier than the prior group's day) under the current view
   * order. Used to paint those rows red while reordering.
   */
  const dayOrderViolations = useMemo(() => {
    const v = new Set<string>();
    let prev = -Infinity;
    for (const g of viewOrderedGroups) {
      const day = g.delivery_day_id ? dayById.get(g.delivery_day_id) : null;
      if (day && day.number < prev) v.add(g.id);
      if (day) prev = day.number;
    }
    return v;
  }, [viewOrderedGroups, dayById]);

  function beginReorder() {
    setReorderMode(true);
    setPendingOrder(sortedGroups.map((g) => g.id));
  }
  function cancelReorder() {
    setReorderMode(false);
    setPendingOrder(null);
    setDragIndex(null);
  }
  function saveReorder() {
    if (!pendingOrder) return;
    const final = pendingOrder;
    startReorder(async () => {
      await reorderLetterGroups(storyline.id, final);
      // Server data flowing back will line up with `final`, so the
      // dirty check below clears itself naturally.
      setPendingOrder(final);
    });
  }

  // Reorder has unsaved changes when the pending order differs from the
  // server's current sortedGroups order.
  const orderDirty =
    !!pendingOrder &&
    (pendingOrder.length !== sortedGroups.length ||
      pendingOrder.some((id, i) => id !== sortedGroups[i]?.id));

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Storyline"
        icon={<BookOpen size={14} aria-hidden className="text-muted-foreground/70" />}
        dirty={orderDirty}
        showSaved
        menu={
          groups.length === 0 ? (
            <OverflowMenu
              items={[
                {
                  label: "Delete Storyline",
                  intent: "destructive",
                  icon: <Trash2 size={12} aria-hidden />,
                  onClick: handleDeleteStoryline,
                },
              ]}
            />
          ) : (
            <span
              aria-hidden
              className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/30"
              title="Delete unavailable: storyline has letter groups"
            >
              <MoreVertical size={14} />
            </span>
          )
        }
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <BackLink onNavigate={onBack} />
        <FieldHighlight peers={peers} focusKey={iconColorFocus}>
          <div onFocus={iconColorField.onFocus} onBlur={iconColorField.onBlur}>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-expanded={pickerOpen}
              aria-label="Edit icon and color"
              title="Edit icon and color"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                pickerOpen ? "border-foreground/60" : "border-border"
              )}
              style={{
                background: state.color_hex,
                color: readableOnHex(state.color_hex),
              }}
            >
              {state.icon_value ? (
                <IconDisplay
                  type={state.icon_type}
                  value={state.icon_value}
                  size={14}
                />
              ) : (
                <span className="font-mono text-[9px] opacity-70">ic</span>
              )}
            </button>
          </div>
        </FieldHighlight>
        <FieldHighlight peers={peers} focusKey={nameFocus} className="flex-1">
          <Input
            value={nameField.value}
            onChange={(e) => {
              setState((s) => ({ ...s, name: e.target.value }));
              nameField.set(e.target.value);
            }}
            onFocus={nameField.onFocus}
            onBlur={nameField.onBlur}
            placeholder="Storyline name"
            className={cn(
              "h-7 w-full px-1 text-base font-semibold text-foreground",
              GHOST_FIELD
            )}
          />
        </FieldHighlight>
        <Label
          htmlFor="storyline-abbr"
          className="shrink-0 self-center"
        >
          Abbr
        </Label>
        <FieldHighlight peers={peers} focusKey={abbrFocus}>
          <Input
            id="storyline-abbr"
            value={abbrField.value}
            onChange={(e) => {
              const next = e.target.value.toUpperCase().slice(0, 1);
              setState((s) => ({ ...s, abbreviation: next }));
              abbrField.set(next);
            }}
            onFocus={abbrField.onFocus}
            onBlur={abbrField.onBlur}
            maxLength={1}
            className={cn(
              "h-7 w-7 shrink-0 px-0 text-center font-mono text-xs uppercase",
              GHOST_FIELD
            )}
          />
        </FieldHighlight>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Description</Label>
          <FieldHighlight peers={peers} focusKey={descriptionFocus}>
            <AutoTextarea
              value={descriptionField.value ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setState((s) => ({ ...s, description: next }));
                descriptionField.set(next);
              }}
              onFocus={descriptionField.onFocus}
              onBlur={descriptionField.onBlur}
              minRows={2}
              className={GHOST_FIELD}
            />
          </FieldHighlight>
        </div>
      </div>

      {pickerOpen && (
        <IconPickerDialog
          title="Edit icon"
          initialType={state.icon_type}
          initialValue={state.icon_value}
          initialColor={state.color_hex}
          onSave={(p) => {
            const updated = {
              icon_type: p.type,
              icon_value: p.value || null,
              color_hex: p.color,
            };
            setState((s) => ({ ...s, ...updated }));
            iconColorField.set(updated);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="mt-4 rounded-md border border-border">
        <div className="flex h-10 items-center gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3">
          <Mails
            size={14}
            aria-hidden
            className="text-muted-foreground/70"
          />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Letter Groups
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ReorderControls
              locked={!reorderMode}
              dirty={orderDirty}
              pending={reorderPending}
              onUnlock={beginReorder}
              onCancel={cancelReorder}
              onSave={saveReorder}
            />
            <OverflowMenu
              items={[
                {
                  label: "Letter Group",
                  icon: (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden>+</span>
                      <Mails size={11} aria-hidden />
                    </span>
                  ),
                  onClick: handleAddGroup,
                },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-col overflow-hidden rounded-b-md">
          {viewOrderedGroups.map((g, i) => {
            const count = letterCountByGroup.get(g.id) ?? 0;
            const day = g.delivery_day_id
              ? dayById.get(g.delivery_day_id)
              : null;
            const active = !reorderMode && g.id === selectedGroupId;
            const violates = reorderMode && dayOrderViolations.has(g.id);
            const rowContent = (
              <>
                {reorderMode ? (
                  <span
                    aria-hidden
                    className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </span>
                ) : null}
                <LetterGroupPill storyline={storyline} sequence={g.sequence} />
                <span className="truncate">{g.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {count} letter{count === 1 ? "" : "s"}
                </span>
                {day ? (
                  <Badge
                    variant="muted"
                    className={cn(
                      "ml-1 shrink-0",
                      violates && "bg-destructive/15 text-destructive"
                    )}
                  >
                    {day.identifier}
                  </Badge>
                ) : null}
              </>
            );
            if (reorderMode) {
              return (
                <div
                  key={g.id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => {
                    if (dragIndex === null || dragIndex === i) return;
                    e.preventDefault();
                    const current =
                      pendingOrder ?? sortedGroups.map((x) => x.id);
                    const next = current.slice();
                    const [moved] = next.splice(dragIndex, 1);
                    next.splice(i, 0, moved);
                    setPendingOrder(next);
                    setDragIndex(i);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={cn(
                    "flex items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm first:border-t-0",
                    dragIndex === i && "opacity-60",
                    violates && "bg-destructive/5"
                  )}
                >
                  {rowContent}
                </div>
              );
            }
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  if (g.id === selectedGroupId) {
                    // Toggle off — return to storyline-only mode so the
                    // inspector stays visible without any group open.
                    onDeselectGroup();
                  } else {
                    onSelectGroup(g.id);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm first:border-t-0",
                  active ? "bg-accent/40" : "hover:bg-accent/30"
                )}
              >
                {rowContent}
              </button>
            );
          })}
          {sortedGroups.length === 0 ? (
            <p className="px-4 py-4 text-center text-sm text-muted-foreground">
              No letter groups yet.
            </p>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}

function StorylinesListPanel({
  storylines,
  groups,
  letters,
  days,
  selectedGroupId,
  selectedLetterId,
  selectedStorylineId,
  onSelectGroup,
  onSelectLetter,
  onOpenStoryline,
}: {
  storylines: Storyline[];
  groups: LetterGroup[];
  letters: InspectionLetterView[];
  days: Day[];
  selectedGroupId: string | null;
  selectedLetterId: string | null;
  selectedStorylineId: string | null;
  onSelectGroup: (id: string) => void;
  onSelectLetter: (id: string) => void;
  onOpenStoryline: (id: string | null) => void;
}) {
  const [groupMode, setGroupMode] = useState<"storyline" | "day">("storyline");
  // Default to all rows collapsed.
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(
    () => new Set()
  );
  const storylineById = useMemo(
    () => new Map(storylines.map((s) => [s.id, s])),
    [storylines]
  );

  const groupsByStoryline = useMemo(() => {
    const m = new Map<string, LetterGroup[]>();
    for (const g of groups) {
      const arr = m.get(g.storyline_id) ?? [];
      arr.push(g);
      m.set(g.storyline_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sequence - b.sequence);
    return m;
  }, [groups]);

  const letterCountByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of letters) m.set(l.letter_group_id, (m.get(l.letter_group_id) ?? 0) + 1);
    return m;
  }, [letters]);

  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const dayBuckets = useMemo(() => {
    const m = new Map<string | "unscheduled", LetterGroup[]>();
    for (const g of groups) {
      const key = g.delivery_day_id ?? "unscheduled";
      const arr = m.get(key) ?? [];
      arr.push(g);
      m.set(key, arr);
    }
    // Sort groups within each day by storyline abbreviation then sequence.
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const sa = storylineById.get(a.storyline_id)?.abbreviation ?? "";
        const sb = storylineById.get(b.storyline_id)?.abbreviation ?? "";
        if (sa !== sb) return sa.localeCompare(sb);
        return a.sequence - b.sequence;
      });
    }
    // Return ordered list of [bucketKey, day|null, groups].
    const entries: Array<{ key: string; day: Day | null; groups: LetterGroup[] }> = [];
    for (const [key, arr] of m) {
      if (key === "unscheduled") {
        entries.push({ key: "unscheduled", day: null, groups: arr });
      } else {
        const day = dayById.get(key) ?? null;
        entries.push({ key, day, groups: arr });
      }
    }
    entries.sort((a, b) => {
      if (a.key === "unscheduled") return 1;
      if (b.key === "unscheduled") return -1;
      return (a.day?.number ?? 0) - (b.day?.number ?? 0);
    });
    return entries;
  }, [groups, storylineById, dayById]);

  function toggle(id: string) {
    setOpenBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ModeToggle = (
    <div className="flex h-6 items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[10px] font-mono uppercase tracking-wider">
      {(["storyline", "day"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setGroupMode(m)}
          aria-pressed={groupMode === m}
          className={cn(
            "inline-flex h-full items-center rounded px-2 transition-colors",
            groupMode === m
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m === "storyline" ? "Storylines" : "Days"}
        </button>
      ))}
    </div>
  );

  function renderGroupRow(g: LetterGroup, opts: { showStoryline: boolean; showDay: boolean }) {
    const s = storylineById.get(g.storyline_id);
    const active = g.id === selectedGroupId;
    const count = letterCountByGroup.get(g.id) ?? 0;
    const day = g.delivery_day_id ? dayById.get(g.delivery_day_id) : null;
    const groupKey = `group:${g.id}`;
    const groupOpen = openBuckets.has(groupKey);
    const groupLetters = letters
      .filter((l) => l.letter_group_id === g.id)
      .slice()
      .sort((a, b) => {
        const va = a.variant ?? "";
        const vb = b.variant ?? "";
        if (va !== vb) return va.localeCompare(vb);
        return (a.piece ?? 0) - (b.piece ?? 0);
      });
    return (
      <div
        key={g.id}
        className={cn(
          "border-t border-border first:border-t-0",
          active && "bg-accent/40"
        )}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => onSelectGroup(g.id)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 pl-3 pr-1 py-1.5 text-left text-sm",
              !active && "hover:bg-accent/30"
            )}
          >
            {opts.showDay && day ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                {day.identifier}
              </span>
            ) : null}
            <LetterGroupPill storyline={s} sequence={g.sequence} />
            <span className="min-w-0 flex-1 truncate">
              {opts.showStoryline && s ? (
                <>
                  <span className="text-muted-foreground/80">{s.name}: </span>
                  {g.name}
                </>
              ) : (
                g.name
              )}
            </span>
            <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 font-mono text-[10px] text-muted-foreground">
              <MailOpen size={11} aria-hidden />
              {count}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggle(groupKey)}
            aria-expanded={groupOpen}
            aria-label={groupOpen ? "Hide letters" : "Show letters"}
            className="inline-flex w-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          >
            <ChevronLeft
              size={12}
              aria-hidden
              className={cn(
                "transition-transform",
                groupOpen && "-rotate-90"
              )}
            />
          </button>
        </div>
        {groupOpen ? (
          <div className="flex flex-col border-t border-border bg-black/20">
            {groupLetters.map((l) => {
              const letterActive = l.id === selectedLetterId;
              const overrideDay = l.delivery_day_override_id
                ? dayById.get(l.delivery_day_override_id)
                : null;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onSelectLetter(l.id)}
                  className={cn(
                    "flex items-center gap-2 px-6 py-1 text-left text-xs",
                    letterActive ? "bg-accent/40" : "hover:bg-accent/30"
                  )}
                >
                  {overrideDay ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {overrideDay.identifier}
                    </span>
                  ) : null}
                  <InspectionLetterPill
                    storyline={s}
                    contentId={l.content_id}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {l.summary || (
                      <span className="italic text-muted-foreground/60">
                        (no summary)
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {groupLetters.length === 0 ? (
              <p className="px-6 py-2 text-xs text-muted-foreground/60">
                No letters
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="All Letters"
        icon={<MailOpen size={14} aria-hidden className="text-muted-foreground/70" />}
        menu={ModeToggle}
      />
      <div className="flex flex-col gap-3 p-4">

      <div className={groupMode === "storyline" ? "flex flex-col gap-3" : "hidden"}>
        {storylines.map((s) => {
          const bucket = groupsByStoryline.get(s.id) ?? [];
          const open = openBuckets.has(s.id);
          const headerActive = s.id === selectedStorylineId;
          const totalLetters = bucket.reduce(
            (sum, g) => sum + (letterCountByGroup.get(g.id) ?? 0),
            0
          );
          return (
            <div
              key={s.id}
              className={cn(
                "overflow-hidden rounded-md border border-border bg-card",
                headerActive && "border-foreground/40"
              )}
            >
              <div
                className={cn(
                  "flex items-center text-left",
                  headerActive ? "bg-accent/40" : "hover:bg-accent/20"
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    onOpenStoryline(headerActive ? null : s.id)
                  }
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-2 pr-1 text-left"
                  title={headerActive ? `Close ${s.name}` : `Open ${s.name}`}
                >
                  <StorylinePill storyline={s} className="min-w-0 flex-1" />
                  <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                    <Mails size={11} aria-hidden />
                    {bucket.length}
                  </span>
                  <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 font-mono text-[10px] text-muted-foreground">
                    <MailOpen size={11} aria-hidden />
                    {totalLetters}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-expanded={open}
                  aria-label={open ? "Collapse" : "Expand"}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft
                    size={12}
                    aria-hidden
                    className={cn(
                      "transition-transform",
                      open && "-rotate-90"
                    )}
                  />
                </button>
              </div>
              {open ? (
                <div className="flex flex-col border-t border-border">
                  {bucket.map((g) =>
                    renderGroupRow(g, { showStoryline: false, showDay: true })
                  )}
                  {bucket.length === 0 ? (
                    <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
                      No groups yet.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={groupMode === "day" ? "flex flex-col gap-3" : "hidden"}>
        {dayBuckets.map(({ key, day, groups: bucket }) => {
          const open = openBuckets.has(`day:${key}`);
          const totalLetters = bucket.reduce(
            (sum, g) => sum + (letterCountByGroup.get(g.id) ?? 0),
            0
          );
          return (
            <div
              key={key}
              className="overflow-hidden rounded-md border border-border bg-card"
            >
              <div className="flex items-center text-left hover:bg-accent/20">
                <button
                  type="button"
                  onClick={() => toggle(`day:${key}`)}
                  aria-expanded={open}
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-2 pr-1 text-left"
                >
                  {day ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {day.identifier}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {day
                      ? `${day.until_qup != null ? day.until_qup : "—"} Days until QUP`
                      : "Unscheduled"}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                    <Mails size={11} aria-hidden />
                    {bucket.length}
                  </span>
                  <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 font-mono text-[10px] text-muted-foreground">
                    <MailOpen size={11} aria-hidden />
                    {totalLetters}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggle(`day:${key}`)}
                  aria-label={open ? "Collapse" : "Expand"}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft
                    size={12}
                    aria-hidden
                    className={cn("transition-transform", open && "-rotate-90")}
                  />
                </button>
              </div>
              {open ? (
                <div className="flex flex-col border-t border-border">
                  {bucket.map((g) =>
                    renderGroupRow(g, { showStoryline: true, showDay: false })
                  )}
                  {bucket.length === 0 ? (
                    <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
                      No groups.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
