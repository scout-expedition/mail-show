"use client";

import {
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
import { PageHeader } from "@/components/page-header";
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
  quickCreateCitizen,
  reorderInspectionLetters,
  reorderLetterGroups,
  saveGroup,
  saveLetterActionsOnly,
  saveLetterFields,
  saveLetterWithActions,
  saveReportSegment,
  updateCitizen,
} from "./actions";
import { updateStorylineFields } from "../storylines/actions";
import { IconPicker } from "@/components/icon-picker";
import { usePathname, useRouter } from "next/navigation";
import { groupSlug, parseGroupSlug } from "@/lib/letter-groups";
import { useConfirm } from "@/components/confirm-dialog";
import {
  ChevronLeft,
  ChevronRight,
  MailOpen,
  Mails,
  Megaphone,
  Milestone,
  MoreVertical,
  Save,
  Trash2,
} from "lucide-react";
import {
  IconCircleMinus,
  IconDiamond,
  IconHammer,
  IconMailOpened,
  IconRestore,
  IconWorldBolt,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";

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
    icon: <IconHammer size={14} aria-hidden />,
  },
  {
    key: "impact_gentry",
    label: "Gentry",
    icon: <IconDiamond size={14} aria-hidden />,
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

type ActionState = ActionImpacts & {
  id: string;
  action_template_id: string | null;
  name: string;
  icon_type: ActionRow["icon_type"];
  icon_value: string | null;
  color_hex: string;
  report_segment_id: string | null;
  next_letter_variant: string | null;
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
  actions: ActionRow[]
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

export function LettersWorkspace({
  storylines,
  groups: allGroups,
  days,
  letters: allLetters,
  actions: allActions,
  templates,
  heroes: initialHeroes,
  allCitizenIds,
  cities,
  nations,
  segments: allSegments,
  initialGroupId,
  initialLetterId,
  initialSegmentId,
}: {
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
  initialGroupId: string | null;
  initialLetterId: string | null;
  initialSegmentId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const { ask: askUnsaved, dialog: unsavedDialogEl } = useUnsavedDialog();
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
    return allLetters
      .filter((l) => l.letter_group_id === nextGroup.id)
      .slice()
      .sort((a, b) => {
        const va = a.variant ?? "";
        const vb = b.variant ?? "";
        if (va !== vb) return va.localeCompare(vb);
        return (a.piece ?? 0) - (b.piece ?? 0);
      });
  }, [allLetters, nextGroup]);

  // ----- Group state -----
  const [groupState, setGroupState] = useState(() => ({
    storyline_id: group?.storyline_id ?? "",
    name: group?.name ?? "",
    delivery_day_id: group?.delivery_day_id ?? null,
    notes: group?.notes ?? null,
  }));
  const [groupDirty, setGroupDirty] = useState(false);
  const [groupPending, startGroupSave] = useTransition();

  useEffect(() => {
    if (!group) {
      setGroupState({
        storyline_id: "",
        name: "",
        delivery_day_id: null,
        notes: null,
      });
      setGroupDirty(false);
      return;
    }
    setGroupState({
      storyline_id: group.storyline_id,
      name: group.name,
      delivery_day_id: group.delivery_day_id,
      notes: group.notes,
    });
    setGroupDirty(false);
  }, [group]);

  function updateGroup<K extends keyof typeof groupState>(
    k: K,
    v: (typeof groupState)[K]
  ) {
    setGroupState((s) => ({ ...s, [k]: v }));
    setGroupDirty(true);
  }

  // ----- Letter state -----
  const [selectedId, setSelectedId] = useState<string | null>(
    initialLetterId ?? (initialSegmentId ? null : letters[0]?.id ?? null)
  );
  const [letterState, setLetterState] = useState<LetterState | null>(() => {
    const initId =
      initialLetterId ?? (initialSegmentId ? null : letters[0]?.id ?? null);
    const init = initId ? letters.find((l) => l.id === initId) : null;
    return init ? toLetterState(init, actions) : null;
  });
  const [listLocked, setListLocked] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [letterDirty, setLetterDirty] = useState(false);
  const [letterPending, startLetterSave] = useTransition();
  const [actionsDirty, setActionsDirty] = useState(false);
  const [actionsPending, startActionsSave] = useTransition();
  const [rowPending, startRowAction] = useTransition();
  const anyLetterDirty = letterDirty || actionsDirty;
  const [view, setView] = useState<
    "list" | "group" | "main" | "actions" | "segment"
  >(
    initialSegmentId
      ? "segment"
      : initialLetterId
        ? "main"
        : initialGroupId
          ? "group"
          : "list"
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialSegmentId
  );

  // Keep URL in sync with the currently-focused entity.
  useEffect(() => {
    const currentAbbr = group
      ? storylineById.get(group.storyline_id)?.abbreviation ?? ""
      : "";
    const slug = group && currentAbbr ? groupSlug(currentAbbr, group.sequence) : null;
    let target = pathname;
    if (slug) {
      if (selectedSegmentId) {
        const seg = segments.find((s) => s.id === selectedSegmentId);
        if (seg?.variant) {
          target = `${pathname}?report=${encodeURIComponent(`${slug}/${seg.variant}`)}`;
        } else {
          target = `${pathname}?group=${encodeURIComponent(slug)}`;
        }
      } else if (selectedId) {
        const l = letters.find((x) => x.id === selectedId);
        if (l?.variant) {
          target = `${pathname}?letter=${encodeURIComponent(`${slug}/${l.variant}`)}`;
        } else {
          target = `${pathname}?group=${encodeURIComponent(slug)}`;
        }
      } else {
        target = `${pathname}?group=${encodeURIComponent(slug)}`;
      }
    }
    router.replace(target, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, selectedId, selectedSegmentId]);

  async function revertGroup() {
    if (!group || !groupDirty) return;
    const ok = await confirmDialog({
      title: "Discard group changes?",
      message: "Any unsaved edits to the group will be lost.",
      confirmLabel: "Revert",
      intent: "destructive",
    });
    if (!ok) return;
    setGroupState({
      storyline_id: group.storyline_id,
      name: group.name,
      delivery_day_id: group.delivery_day_id,
      notes: group.notes,
    });
    setGroupDirty(false);
  }

  async function revertLetter() {
    if (!letterState || !letterDirty) return;
    const ok = await confirmDialog({
      title: "Discard letter changes?",
      message: "Any unsaved edits to this letter's fields will be lost.",
      confirmLabel: "Revert",
      intent: "destructive",
    });
    if (!ok) return;
    const server = letters.find((l) => l.id === letterState.id);
    if (server) {
      // Only restore the letter fields; keep any in-flight action edits.
      setLetterState((s) =>
        s
          ? {
              ...s,
              piece: server.piece,
              delivery_day_override_id: server.delivery_day_override_id,
              summary: server.summary,
              content: server.content,
              sender_citizen_id: server.sender_citizen_id,
              receiver_citizen_id: server.receiver_citizen_id,
              notes: server.notes,
            }
          : s
      );
    }
    setLetterDirty(false);
  }

  async function revertActions() {
    if (!letterState || !actionsDirty) return;
    const ok = await confirmDialog({
      title: "Discard action changes?",
      message: "Any unsaved edits to this letter's actions will be lost.",
      confirmLabel: "Revert",
      intent: "destructive",
    });
    if (!ok) return;
    const server = letters.find((l) => l.id === letterState.id);
    if (server) {
      const fresh = toLetterState(server, actions);
      setLetterState((s) => (s ? { ...s, actions: fresh.actions } : s));
    }
    setActionsDirty(false);
  }

  // Slot 1 can host either a group or a storyline inspector — mutually
  // exclusive. Selecting a storyline clears any active group and vice versa.
  const [selectedStorylineId, setSelectedStorylineId] = useState<string | null>(
    null
  );
  const [storylineDirty, setStorylineDirty] = useState(false);

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

  useEffect(() => {
    function applyPanelSnapshot(s: PanelSnapshot) {
      applyingPanelSnapshot.current = true;
      setSelectedStorylineId(s.storylineId);
      setSelectedGroupId(s.groupId);
      setSelectedId(s.letterId);
      setSelectedSegmentId(s.segmentId);
      setView(s.view);
      // Discard any in-progress edits when jumping — matches browser
      // back/forward semantics (you lose the form state you hadn't
      // committed). The forward button can re-enter the panel.
      setLetterDirty(false);
      setGroupDirty(false);
      setStorylineDirty(false);
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
      if (e.button === 3) goPanelBack();
      else goPanelForward();
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
      if (isBack) goPanelBack();
      else goPanelForward();
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
        if (bump()) goPanelBack();
      } else if (trap === "forward") {
        restoring = true;
        history.back();
        if (bump()) goPanelForward();
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

  async function confirmDiscardDirty(message: string): Promise<boolean> {
    if (!(groupDirty || anyLetterDirty || storylineDirty)) return true;
    return onConfirmDiscard(message);
  }
  async function onConfirmDiscard(message: string): Promise<boolean> {
    return confirmDialog({
      title: "Discard unsaved changes?",
      message,
      confirmLabel: "Discard",
      intent: "destructive",
    });
  }

  async function selectGroup(id: string | null) {
    if (id === selectedGroupId || id === null) {
      if (
        !(await confirmDiscardDirty(
          "Unsaved changes will be lost. Close anyway?"
        ))
      )
        return;
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
      setLetterDirty(false);
      setGroupDirty(false);
      setStorylineDirty(false);
      setSelectedSegmentId(null);
      setView("list");
      return;
    }
    if (
      !(await confirmDiscardDirty(
        "Unsaved changes will be lost. Switch groups anyway?"
      ))
    )
      return;
    setSelectedGroupId(id);
    setSelectedStorylineId(null);
    setSelectedId(null);
    setLetterState(null);
    setLetterDirty(false);
    setGroupDirty(false);
    setStorylineDirty(false);
    setSelectedSegmentId(null);
    // Slide to the group view (inspector + group detail side-by-side).
    setView("group");
  }

  async function selectStoryline(id: string | null) {
    if (
      !(await confirmDiscardDirty(
        "Unsaved changes will be lost. Switch storylines anyway?"
      ))
    )
      return;
    setSelectedStorylineId(id);
    setSelectedGroupId(null);
    setSelectedId(null);
    setLetterState(null);
    setLetterDirty(false);
    setGroupDirty(false);
    setStorylineDirty(false);
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
      setLetterState(letters[0] ? toLetterState(letters[0], actions) : null);
      setLetterDirty(false);
      return;
    }
    // Only overwrite if not dirty; otherwise preserve user edits.
    if (!(letterDirty || actionsDirty)) {
      setLetterState(toLetterState(found, actions));
    }
  }, [letters, actions, selectedId, letterDirty, actionsDirty]);

  async function selectLetter(id: string) {
    if (id === selectedId) {
      // Toggle off — deselect the current letter, but keep the slide
      // position so the group panel stays on the left where the user
      // put it. Slot 2 will just render the "Select a letter…" empty
      // state until they pick another.
      if (anyLetterDirty) {
        const ok = await onConfirmDiscard(
          "This letter has unsaved changes. Discard them and close?"
        );
        if (!ok) return;
      }
      setSelectedId(null);
      setLetterState(null);
      setLetterDirty(false);
      setActionsDirty(false);
      setSelectedSegmentId(null);
      return;
    }
    if (anyLetterDirty) {
      const ok = await onConfirmDiscard(
        "This letter has unsaved changes. Discard them and switch?"
      );
      if (!ok) return;
    }
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    setSelectedId(id);
    setLetterState(toLetterState(l, actions));
    setLetterDirty(false);
    setActionsDirty(false);
    setView("main");
    setSelectedSegmentId(null);
  }

  /**
   * Pick a letter from the list panel — may live in a different group.
   * Switches the active group when needed and lands on the letter view.
   */
  async function selectLetterFromList(id: string) {
    const target = allLetters.find((l) => l.id === id);
    if (!target) return;
    if (anyLetterDirty) {
      const ok = await onConfirmDiscard(
        "This letter has unsaved changes. Discard them and switch?"
      );
      if (!ok) return;
    }
    if (target.letter_group_id !== selectedGroupId) {
      setSelectedGroupId(target.letter_group_id);
    }
    setSelectedId(id);
    setLetterDirty(false);
    setActionsDirty(false);
    setSelectedSegmentId(null);
    setView("main");
  }

  async function closeActionsPanel() {
    if (actionsDirty) {
      const ok = await confirmDialog({
        title: "Save actions before closing?",
        message: "Actions have unsaved changes.",
        confirmLabel: "Save",
      });
      if (ok && letterState) {
        const snap = letterState;
        startActionsSave(async () => {
          await saveLetterActionsOnly(letterActionsPatches(snap));
          setActionsDirty(false);
          setView("main");
        });
        return;
      }
    }
    setView("main");
  }

  function openSegmentForAction(actionIdx: number) {
    const segId = letterState?.actions[actionIdx]?.report_segment_id ?? null;
    if (!segId) return;
    setSelectedSegmentId(segId);
    setView("segment");
  }

  /**
   * Open a segment directly from the group panel — used by the "Report
   * segments" list. Segments can be triggered by several actions across
   * different letters; to avoid forcing the user through the
   * actions-of-one-specific-letter path, we slide to view="main" and
   * render the segment card in slot 2 (where the letter fields usually
   * live) instead of going all the way to view="segment".
   */
  async function openSegmentFromGroup(segmentId: string) {
    if (anyLetterDirty) {
      const ok = await confirmDialog({
        title: "Discard letter changes?",
        message:
          "The open letter has unsaved edits. Opening the report segment will discard them.",
        confirmLabel: "Discard",
        intent: "destructive",
      });
      if (!ok) return;
      setLetterDirty(false);
      setActionsDirty(false);
    }
    setSelectedId(null);
    setSelectedSegmentId(segmentId);
    setView("main");
  }

  async function closeSegmentPanel(
    segmentDirty: boolean,
    onSave: () => Promise<void>
  ) {
    // Segments opened from the group panel live in slot 3 (view="main");
    // segments opened from an action live in slot 5 (view="segment"). Back
    // returns to the panel that brought us here.
    const targetView: "main" | "actions" | "group" = letterState
      ? "actions"
      : "group";
    if (segmentDirty) {
      const ok = await confirmDialog({
        title: "Save segment before closing?",
        message: "Segment has unsaved changes.",
        confirmLabel: "Save",
      });
      if (ok) {
        startRowAction(async () => {
          await onSave();
          setView(targetView);
          setSelectedSegmentId(null);
        });
        return;
      }
    }
    setView(targetView);
    setSelectedSegmentId(null);
  }

  /**
   * Jump from the segment panel to the actions panel for a specific letter
   * — used by the segment's "Triggers" list. Also switches the group
   * selection if the trigger lives in a different letter group (e.g. a
   * sibling storyline's letter pointing at this segment).
   */
  async function jumpToTrigger(
    letterId: string,
    segmentDirty: boolean,
    onSave: () => Promise<void>
  ) {
    const target = allLetters.find((l) => l.id === letterId);
    if (!target) return;
    const doJump = () => {
      if (target.letter_group_id !== selectedGroupId) {
        setSelectedGroupId(target.letter_group_id);
      }
      setSelectedId(letterId);
      setSelectedSegmentId(null);
      setView("actions");
    };
    if (segmentDirty) {
      const ok = await confirmDialog({
        title: "Save segment before jumping?",
        message: "Segment has unsaved changes.",
        confirmLabel: "Save",
      });
      if (ok) {
        startRowAction(async () => {
          await onSave();
          doJump();
        });
        return;
      }
    }
    doJump();
  }

  function updateLetter(patch: Partial<LetterState>) {
    setLetterState((s) => (s ? { ...s, ...patch } : s));
    setLetterDirty(true);
  }

  function updateAction(idx: number, patch: Partial<ActionState>) {
    setLetterState((s) => {
      if (!s) return s;
      const next = s.actions.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...s, actions: next };
    });
    setActionsDirty(true);
  }

  function letterFieldsPatch(state: LetterState) {
    return {
      id: state.id,
      piece: state.piece,
      delivery_day_override_id: state.delivery_day_override_id,
      summary: state.summary,
      content: state.content,
      sender_citizen_id: state.sender_citizen_id,
      receiver_citizen_id: state.receiver_citizen_id,
      notes: state.notes,
    };
  }
  function letterActionsPatches(state: LetterState) {
    return state.actions.map((a) => ({
      id: a.id,
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
    }));
  }

  /** Save both the letter row and its actions in one shot. Used when an
   *  outer flow (closing the letter, saving the group together, etc.)
   *  needs to flush every dirty bit on the letter at once. */
  async function saveLetterNow(state: LetterState) {
    if (!group) return;
    await saveLetterWithActions(
      group.id,
      letterFieldsPatch(state),
      letterActionsPatches(state)
    );
  }

  function handleSaveLetterFields() {
    if (!letterState) return;
    const state = letterState;
    startLetterSave(async () => {
      await saveLetterFields(letterFieldsPatch(state));
      setLetterDirty(false);
    });
  }

  function handleSaveActions() {
    if (!letterState) return;
    const state = letterState;
    startActionsSave(async () => {
      await saveLetterActionsOnly(letterActionsPatches(state));
      setActionsDirty(false);
    });
  }

  async function handleSaveGroup() {
    if (!group) return;
    const groupId = group.id;
    let alsoSaveLetter = false;
    if (anyLetterDirty && letterState) {
      alsoSaveLetter = await confirmDialog({
        title: "Save the open letter too?",
        message:
          "The open letter has unsaved changes. Save the letter along with the group?",
        confirmLabel: "Save both",
      });
    }
    const snapshot = letterState;
    startGroupSave(async () => {
      await saveGroup({
        id: groupId,
        storyline_id: groupState.storyline_id,
        name: groupState.name,
        notes: groupState.notes,
        delivery_day_id: groupState.delivery_day_id,
      });
      setGroupDirty(false);
      if (alsoSaveLetter && snapshot) {
        await saveLetterNow(snapshot);
        setLetterDirty(false);
        setActionsDirty(false);
      }
    });
  }

  async function handleAddLetters(count: number) {
    if (!group) return;
    const groupId = group.id;
    if (anyLetterDirty) {
      const ok = await onConfirmDiscard(
        "The open letter has unsaved changes. Discard them and add?"
      );
      if (!ok) return;
    }
    startRowAction(async () => {
      const ids = await createInspectionLettersInGroup(groupId, count);
      if (ids[0]) setSelectedId(ids[0]);
      setLetterDirty(false);
      setActionsDirty(false);
    });
  }

  async function handleAddPiece(letterId: string) {
    if (!group) return;
    const groupId = group.id;
    if (anyLetterDirty) {
      const ok = await onConfirmDiscard(
        "The open letter has unsaved changes. Discard them and add a piece?"
      );
      if (!ok) return;
    }
    startRowAction(async () => {
      const { newLetterId } = await addPieceToLetter(groupId, letterId);
      setSelectedId(newLetterId);
      setLetterDirty(false);
      setActionsDirty(false);
    });
  }

  async function handleDeleteLetter(id: string) {
    if (!group) return;
    const groupId = group.id;
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    const ok = await confirmDialog({
      title: "Delete letter?",
      message: `${l.content_id} will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startRowAction(async () => {
      await deleteInspectionLetter(groupId, id);
      if (selectedId === id) {
        setSelectedId(null);
        setLetterState(null);
        setLetterDirty(false);
      }
    });
  }

  async function handleDeleteGroup() {
    if (!group) return;
    const groupId = group.id;
    const ok = await confirmDialog({
      title: "Delete letter group?",
      message: `"${group.name}" and all of its letters will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startGroupSave(async () => {
      await deleteGroup(groupId);
    });
  }

  async function handleAddAction(templateId: string) {
    if (!group) return;
    const groupId = group.id;
    if (!selectedId || !templateId) return;
    if (anyLetterDirty) {
      const ok = await confirmDialog({
        title: "Save letter before adding action?",
        message:
          "This letter has unsaved changes. Save them before adding an action? Cancel to discard them.",
        confirmLabel: "Save",
      });
      if (ok && letterState) {
        const snap = letterState;
        startRowAction(async () => {
          await saveLetterNow(snap);
          await addActionFromTemplate(groupId, selectedId, templateId);
          setLetterDirty(false);
          setActionsDirty(false);
        });
        return;
      }
    }
    startRowAction(async () => {
      await addActionFromTemplate(groupId, selectedId!, templateId);
      setLetterDirty(false);
      setActionsDirty(false);
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

  const narrow = useIsNarrow();
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
  async function goToBreadcrumb(level: "root" | "group" | "letter" | "actions") {
    type DirtyPanel = {
      key: string;
      title: string;
      message: string;
      isDirty: () => boolean;
      save: () => Promise<void>;
      discard: () => void;
    };
    const closing: DirtyPanel[] = [];
    // List the panels (innermost first) that this navigation would
    // close. Add only if they're currently dirty.
    if (level === "root" || level === "group" || level === "letter") {
      if (actionsDirty) {
        closing.push({
          key: "actions",
          title: "Save changes to actions?",
          message:
            "This letter's actions have unsaved edits.",
          isDirty: () => actionsDirty,
          save: async () => {
            if (!letterState) return;
            await saveLetterActionsOnly(letterActionsPatches(letterState));
            setActionsDirty(false);
          },
          discard: () => setActionsDirty(false),
        });
      }
    }
    if (level === "root" || level === "group") {
      if (letterDirty) {
        closing.push({
          key: "letter",
          title: "Save changes to inspection letter?",
          message: "This letter has unsaved edits.",
          isDirty: () => letterDirty,
          save: async () => {
            if (!letterState) return;
            await saveLetterFields(letterFieldsPatch(letterState));
            setLetterDirty(false);
          },
          discard: () => setLetterDirty(false),
        });
      }
    }
    if (level === "root") {
      if (groupDirty && group) {
        const groupId = group.id;
        const snap = { ...groupState };
        closing.push({
          key: "group",
          title: "Save changes to letter group?",
          message: "The open letter group has unsaved edits.",
          isDirty: () => groupDirty,
          save: async () => {
            await saveGroup({
              id: groupId,
              storyline_id: snap.storyline_id,
              name: snap.name,
              notes: snap.notes,
              delivery_day_id: snap.delivery_day_id,
            });
            setGroupDirty(false);
          },
          discard: () => setGroupDirty(false),
        });
      }
    }

    // Storyline saves live inside StorylineInspector and aren't exposed
    // here — fall back to a simple Discard/Cancel for now and ask the
    // user to save from the inspector if they want to keep edits.
    if (level === "root" && storylineDirty) {
      const ok = await confirmDialog({
        title: "Discard storyline changes?",
        message:
          "The open storyline has unsaved edits. Save them from the storyline panel first if you want to keep them.",
        confirmLabel: "Discard",
        intent: "destructive",
      });
      if (!ok) return;
      setStorylineDirty(false);
    }

    for (const panel of closing) {
      if (!panel.isDirty()) continue;
      const outcome = await askUnsaved(panel.title, panel.message);
      if (outcome === "cancel") return;
      if (outcome === "save") {
        await panel.save();
      } else {
        panel.discard();
      }
    }

    if (level === "root") {
      setSelectedGroupId(null);
      setSelectedStorylineId(null);
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setGroupDirty(false);
      setLetterDirty(false);
      setActionsDirty(false);
      setStorylineDirty(false);
      setView("list");
    } else if (level === "group") {
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setLetterDirty(false);
      setActionsDirty(false);
      setView("group");
    } else if (level === "letter") {
      setSelectedSegmentId(null);
      setActionsDirty(false);
      setView("main");
    } else if (level === "actions") {
      setSelectedSegmentId(null);
      setView("actions");
    }
  }

  return (
    <div className="flex flex-col gap-6">
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
      </div>

      <div className="relative overflow-hidden">
        <div
          className={cn(
            "flex w-[600%] transition-transform duration-300 ease-out lg:w-[300%]"
          )}
          style={{ transform: `translateX(${slideOffset}%)` }}
        >
        {/* Slot 0 — storylines list (always). */}
        <div className="flex w-1/6 shrink-0 flex-col gap-4 pr-3">
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
        <div className="flex w-1/6 shrink-0 flex-col gap-4 px-3">
          {inspectorStoryline ? (
            <StorylineInspector
              key={inspectorStoryline.id}
              storyline={inspectorStoryline}
              groups={allGroups.filter(
                (g) => g.storyline_id === inspectorStoryline.id
              )}
              allLetters={allLetters}
              days={days}
              dirty={storylineDirty}
              selectedGroupId={selectedGroupId}
              onDirtyChange={setStorylineDirty}
              onBack={() =>
                group
                  ? selectStoryline(group.storyline_id)
                  : selectStoryline(null)
              }
              onSelectGroup={(id) => selectGroup(id)}
              onDeselectGroup={() =>
                selectStoryline(inspectorStoryline.id)
              }
              onConfirmDialog={confirmDialog}
            />
          ) : (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Pick a storyline or a letter group to begin.
            </div>
          )}
        </div>

        {/* Slot 2 — letter group card (letters list + report segments
            list). Hidden placeholder when no group is selected. */}
        <div className="flex w-1/6 shrink-0 flex-col gap-4 px-3">
          {!group ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Pick a letter group from the inspector.
            </div>
          ) : (
          <>
          <div className="rounded-md border border-border bg-card">
            <PanelHeader
              title="Letter Group"
              dirty={groupDirty || !!orderOverride}
              showSaved={!!group}
              saveRevert={
                <SaveRevert
                  dirty={groupDirty}
                  pending={groupPending}
                  onSave={handleSaveGroup}
                  onRevert={revertGroup}
                />
              }
              menu={
                <OverflowMenu
                  items={[
                    {
                      label: "Delete letter group",
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
                <Input
                  value={groupState.name}
                  onChange={(e) => updateGroup("name", e.target.value)}
                  placeholder="Group name"
                  className={cn(
                    "h-7 flex-1 px-1 text-base font-semibold text-foreground",
                    GHOST_FIELD
                  )}
                />
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-6 flex flex-col gap-1">
                  <Label>Delivery day</Label>
                  <DaySelect
                    value={groupState.delivery_day_id ?? ""}
                    days={days}
                    onChange={(v) => updateGroup("delivery_day_id", v || null)}
                    className={cn("h-8", GHOST_FIELD)}
                  />
                </div>
                <div className="col-span-6 flex flex-col gap-1">
                  <Label>Notes</Label>
                  <AutoTextarea
                    value={groupState.notes ?? ""}
                    onChange={(e) => updateGroup("notes", e.target.value || null)}
                    minRows={2}
                    className={GHOST_FIELD}
                  />
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border bg-white/[0.04] px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Letters ({letters.length})
              </span>
              <div className="flex items-center gap-2">
                {orderOverride ? (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
                    • Unsaved
                  </span>
                ) : null}
                <SaveRevert
                  dirty={!!orderOverride}
                  pending={rowPending}
                  onSave={() => {
                    if (!orderOverride) return;
                    const final = orderOverride;
                    const groupId = group.id;
                    startRowAction(async () => {
                      await reorderInspectionLetters(groupId, final);
                      setOrderOverride(null);
                    });
                  }}
                  onRevert={() => setOrderOverride(null)}
                />
                <button
                  type="button"
                  onClick={() => setListLocked((v) => !v)}
                  title={listLocked ? "Unlock to reorder" : "Lock"}
                  aria-label={listLocked ? "Unlock to reorder" : "Lock reordering"}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ReorderIcon active={!listLocked} />
                </button>
              </div>
            </div>
            <div className="flex flex-col">
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
                      {active && anyLetterDirty ? (
                        <span className="shrink-0 text-[10px] text-warning">
                          •
                        </span>
                      ) : null}
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
            <div className="flex justify-center border-t border-border px-3 py-2">
              <AddLetterMenu
                pending={rowPending}
                onPick={(n) => handleAddLetters(n)}
              />
            </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-white/[0.04] px-3 py-2">
              <Megaphone
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Report segments ({segments.length})
              </span>
            </div>
            <div className="flex flex-col">
              {segments.map((seg) => {
                const active = seg.id === selectedSegmentId;
                const preview = (seg.content ?? "").trim().split("\n")[0] ?? "";
                return (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => openSegmentFromGroup(seg.id)}
                    className={cn(
                      "flex items-center gap-2 border-t border-border px-3 py-2 text-left first:border-t-0",
                      active ? "bg-accent/40" : "hover:bg-accent/15"
                    )}
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
        <div className="flex w-1/6 shrink-0 flex-col gap-4 px-3">
          {letterState ? (
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
              dirty={letterDirty}
              pending={letterPending}
              onChange={updateLetter}
              onQuickCreateHero={(role) => setHeroDialogRole(role)}
              onEditCitizen={(c) => setEditingCitizen(c)}
              onSave={handleSaveLetterFields}
              onRevert={revertLetter}
              onDelete={() => handleDeleteLetter(letterState.id)}
              onBack={() => selectLetter(letterState.id)}
              actionsCount={letterState.actions.length}
              actionsActive={view === "actions"}
              onShowActions={() => setView("actions")}
            />
          ) : selectedSegmentId ? (
            <LetterSegmentCard
              key={`group-${selectedSegmentId}`}
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
          ) : (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Select a letter to edit, or add one.
            </div>
          )}
        </div>

        {/* Slot 4 — action editors for the currently-open letter. */}
        <div className="flex w-1/6 shrink-0 flex-col gap-4 px-3">
          {letterState ? (
            <LetterActionsCard
              key={letterState.id}
              actions={letterState.actions}
              templates={templates}
              nations={nations}
              segments={segments}
              storyline={currentStoryline}
              nextGroup={nextGroup}
              nextGroupLetters={nextGroupLetters}
              groupId={group?.id ?? ""}
              days={days}
              currentLetterDayId={
                letterState.delivery_day_override_id ??
                groupState.delivery_day_id
              }
              dirty={actionsDirty}
              pending={actionsPending}
              rowPending={rowPending}
              onActionChange={updateAction}
              onAddAction={handleAddAction}
              onDeleteAction={handleDeleteAction}
              onOpenSegment={openSegmentForAction}
              openSegmentId={selectedSegmentId}
              onSave={handleSaveActions}
              onRevert={revertActions}
              onBack={closeActionsPanel}
            />
          ) : null}
        </div>

        {/* Slot 5 — report segment opened from an action. */}
        <div className="flex w-1/6 shrink-0 flex-col gap-4 pl-3">
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
      {unsavedDialogEl}
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
  dirty,
  pending,
  onChange,
  onQuickCreateHero,
  onEditCitizen,
  onSave,
  onRevert,
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
  dirty: boolean;
  pending: boolean;
  onChange: (patch: Partial<LetterState>) => void;
  onQuickCreateHero: (role: "sender" | "receiver") => void;
  onEditCitizen: (citizen: Citizen) => void;
  onSave: () => void;
  onRevert: () => void;
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

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Inspection Letter"
        dirty={dirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty}
            pending={pending}
            onSave={onSave}
            onRevert={onRevert}
          />
        }
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete inspection letter",
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
        <div className="col-span-4 flex flex-col gap-1">
          <Label>Delivery day</Label>
          <DaySelect
            value={currentDayId ?? ""}
            days={days}
            groupDefaultId={groupDeliveryDayId}
            dashWhenGroupDefault
            hideClear
            onChange={(v) =>
              onChange({
                delivery_day_override_id:
                  !v ? null : v === groupDeliveryDayId ? null : v,
              })
            }
            className={cn(
              "h-8",
              GHOST_FIELD,
              state.delivery_day_override_id
                ? undefined
                : "text-muted-foreground/60"
            )}
          />
        </div>
        <div className="col-span-2 flex flex-col items-end justify-end">
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
          <Input
            value={state.summary ?? ""}
            onChange={(e) => onChange({ summary: e.target.value || null })}
            className={cn("h-8", GHOST_FIELD)}
          />
        </div>

        <div className="col-span-3 flex flex-col gap-1">
          <Label>Sender</Label>
          <HeroSearch
            value={state.sender_citizen_id}
            heroes={heroes}
            cities={cities}
            nations={nations}
            placeholder="Add sender"
            onChange={(v) => onChange({ sender_citizen_id: v })}
            onCreate={() => onQuickCreateHero("sender")}
            onEdit={onEditCitizen}
          />
        </div>
        <div className="col-span-3 flex flex-col gap-1">
          <Label>Receiver</Label>
          <HeroSearch
            value={state.receiver_citizen_id}
            heroes={heroes}
            cities={cities}
            nations={nations}
            placeholder="Add receiver"
            onChange={(v) => onChange({ receiver_citizen_id: v })}
            onCreate={() => onQuickCreateHero("receiver")}
            onEdit={onEditCitizen}
          />
        </div>

        <div className="col-span-6 flex flex-col gap-1">
          <Label>Content</Label>
          <MarkdownTextarea
            value={state.content ?? ""}
            onChange={(e) => onChange({ content: e.target.value || null })}
            minRows={6}
            className={cn("font-mono text-xs", GHOST_FIELD)}
          />
        </div>
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Notes</Label>
          <AutoTextarea
            value={state.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value || null })}
            minRows={2}
            className={GHOST_FIELD}
          />
        </div>
      </div>

      <LastUpdatedFooter at={letterView.updated_at} by={letterView.updated_by} />
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
  nextGroup,
  nextGroupLetters,
  groupId,
  days,
  currentLetterDayId,
  dirty,
  pending,
  rowPending,
  onActionChange,
  onAddAction,
  onDeleteAction,
  onOpenSegment,
  openSegmentId,
  onSave,
  onRevert,
  onBack,
}: {
  actions: ActionState[];
  templates: ActionTemplate[];
  nations: Nation[];
  segments: ReportSegmentView[];
  storyline: Storyline | undefined;
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
  groupId: string;
  days: Day[];
  currentLetterDayId: string | null;
  dirty: boolean;
  pending: boolean;
  rowPending: boolean;
  onActionChange: (idx: number, patch: Partial<ActionState>) => void;
  onAddAction: (templateId: string) => void;
  onDeleteAction: (actionId: string) => void;
  onOpenSegment: (actionIdx: number) => void;
  openSegmentId: string | null;
  onSave: () => void;
  onRevert: () => void;
  onBack: () => void;
}) {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Letter Actions"
        dirty={dirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty}
            pending={pending}
            onSave={onSave}
            onRevert={onRevert}
          />
        }
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to letter"
          title="Back to letter"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h4 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Milestone size={14} aria-hidden className="text-muted-foreground/70" />
          Actions ({actions.length})
        </h4>
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
            onChange={(patch) => onActionChange(i, patch)}
            onDelete={() => onDeleteAction(a.id)}
            onOpenSegment={() => onOpenSegment(i)}
            segmentOpen={
              !!a.report_segment_id && a.report_segment_id === openSegmentId
            }
          />
        ))}
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions yet.</p>
        ) : null}
        <div className="flex justify-center pt-1">
          {templatePickerOpen ? (
            <Select
              autoFocus
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setTemplatePickerOpen(false);
                onAddAction(v);
              }}
              onBlur={() => setTemplatePickerOpen(false)}
              className="h-8 w-auto"
              aria-label="Pick action"
            >
              <option value="">Pick action…</option>
              {pickerEntries(templates).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          ) : (
            <button
              type="button"
              onClick={() => setTemplatePickerOpen(true)}
              disabled={rowPending || templates.length === 0}
              className={MUTED_ADD_BTN}
            >
              + Action
            </button>
          )}
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
  onBack: (
    dirty: boolean,
    onSave: () => Promise<void>
  ) => void;
  onDelete: (segmentId: string) => void;
  onJumpToTrigger: (
    letterId: string,
    dirty: boolean,
    onSave: () => Promise<void>
  ) => void;
  onConfirmDialog: (options: {
    title: string;
    message?: string;
    confirmLabel?: string;
    intent?: "destructive" | "default";
  }) => Promise<boolean>;
}) {
  const [state, setState] = useState(() =>
    segment
      ? {
          variant: segment.variant,
          content: segment.content,
          delivery_day_override_id: segment.delivery_day_override_id,
        }
      : { variant: "", content: null as string | null, delivery_day_override_id: null as string | null }
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startSave] = useTransition();

  useEffect(() => {
    if (!segment) return;
    setState({
      variant: segment.variant,
      content: segment.content,
      delivery_day_override_id: segment.delivery_day_override_id,
    });
    setDirty(false);
  }, [segment]);

  async function saveNow() {
    if (!segment) return;
    await saveReportSegment({
      id: segment.id,
      variant: state.variant.trim() || segment.variant,
      content: state.content,
      delivery_day_override_id: state.delivery_day_override_id,
    });
    setDirty(false);
  }

  function update<K extends keyof typeof state>(k: K, v: (typeof state)[K]) {
    setState((s) => ({ ...s, [k]: v }));
    setDirty(true);
  }

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

  const currentDayId = state.delivery_day_override_id;
  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Report Segment"
        dirty={dirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty}
            pending={pending}
            onSave={() => startSave(saveNow)}
            onRevert={async () => {
              if (!dirty || !segment) return;
              const ok = await onConfirmDialog({
                title: "Discard segment changes?",
                message: "Any unsaved edits will be lost.",
                confirmLabel: "Revert",
                intent: "destructive",
              });
              if (!ok) return;
              setState({
                variant: segment.variant,
                content: segment.content,
                delivery_day_override_id: segment.delivery_day_override_id,
              });
              setDirty(false);
            }}
          />
        }
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete report segment",
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
        <button
          type="button"
          onClick={() => onBack(dirty, saveNow)}
          aria-label="Back to actions"
          title="Back to actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <ReportSegmentPill
            storyline={storylines.find((s) => s.id === segment.storyline_id)}
            reportId={segment.report_id}
          />
        </h3>
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Variant</Label>
          <Input
            value={state.variant}
            onChange={(e) =>
              update("variant", formatRomanInput(e.target.value))
            }
            placeholder="i"
            className={cn(
              "h-8 lowercase",
              GHOST_FIELD,
              state.variant && !isValidRoman(state.variant)
                ? "ring-2 ring-destructive"
                : undefined
            )}
          />
        </div>
        <div className="col-span-4 flex flex-col gap-1">
          <Label>Delivery day</Label>
          <DaySelect
            value={
              (state.delivery_day_override_id ?? groupDeliveryDayId) ?? ""
            }
            days={days}
            groupDefaultId={groupDeliveryDayId}
            defaultSuffix="(Following Day)"
            onChange={(v) =>
              update(
                "delivery_day_override_id",
                !v ? null : v === groupDeliveryDayId ? null : v
              )
            }
            className={cn("h-8", GHOST_FIELD)}
          />
        </div>
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Content</Label>
          <MarkdownTextarea
            value={state.content ?? ""}
            onChange={(e) => update("content", e.target.value || null)}
            minRows={8}
            className={cn("font-mono text-xs", GHOST_FIELD)}
          />
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
                  onClick={() =>
                    onJumpToTrigger(t.letterId, dirty, saveNow)
                  }
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
      <LastUpdatedFooter at={segment.updated_at} by={segment.updated_by} />
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
}: {
  parts: ReturnType<typeof addressParts>;
}) {
  const hasAny = parts.citizenId || parts.cityName || parts.nation;
  if (!hasAny) return null;
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
    <span className="truncate pl-3 text-[10px] text-muted-foreground">
      {pieces.map((el, i) => (
        <span key={i}>
          {i > 0 ? <span className="mx-1 opacity-60">·</span> : null}
          {el}
        </span>
      ))}
    </span>
  );
}

function HeroSearch({
  value,
  heroes,
  cities,
  nations,
  placeholder,
  onChange,
  onCreate,
  onEdit,
}: {
  value: string | null;
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  placeholder?: string;
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
      <div className="group flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2 rounded-full bg-muted/40 px-3 py-1">
          <span className="truncate font-mono text-sm">{selected.name}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(selected)}
              aria-label="Edit citizen"
              title="Edit citizen"
              className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
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
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
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
        <AddressLine parts={parts} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="group flex gap-1">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? "Search citizens"}
          className={cn(
            "h-8 flex-1 placeholder:italic",
            GHOST_FIELD
          )}
        />
        <button
          type="button"
          onClick={onCreate}
          aria-label="Create new hero"
          title="Create new hero"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          +
        </button>
      </div>
      {open && matches.length > 0 ? (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-md">
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
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent/40"
              >
                <span className="text-sm">{h.name}</span>
                <AddressLine parts={parts} />
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={MUTED_ADD_BTN}
      >
        {pending ? (
          <>
            <Spinner />
            Working…
          </>
        ) : (
          "+ Inspection Letter"
        )}
      </button>
      {open && !pending ? (
        <div className="absolute bottom-full left-1/2 z-10 mb-1 flex -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-card shadow-md">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(n);
              }}
              className="px-4 py-1.5 text-left text-sm hover:bg-accent/40"
            >
              {n} letter{n > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      ) : null}
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
  onChange,
  onDelete,
  onOpenSegment,
  segmentOpen,
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
  onChange: (patch: Partial<ActionState>) => void;
  onDelete: () => void;
  onOpenSegment: () => void;
  segmentOpen: boolean;
}) {
  const [creatingLetter, startCreateLetter] = useTransition();
  const [creatingSegment, startCreateSegment] = useTransition();
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

  return (
    <div className="rounded-md border border-border bg-black/20 p-3">
      {/* Header row: icon + name only. */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
          style={{ background: colorHex, color: readableOnHex(colorHex) }}
        >
          {iconValue ? (
            <IconDisplay type={iconType} value={iconValue} size={16} />
          ) : null}
        </span>
        <span className="truncate font-semibold">{name}</span>
      </div>

      {/* Links row: Next letter and Report each take half the row; the
          open-segment arrow sits in the Report half. Both columns share
          the same row height (h-7) so the pills line up. */}
      <div className="flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Next letter
          </span>
          <div className="flex h-7 w-full items-center">
            {creatingLetter ? (
              <CreatingPill />
            ) : (
              <PillSelect
                pill={
                  action.next_letter_variant && storyline ? (
                    <InspectionLetterPill
                      storyline={storyline}
                      contentId={(() => {
                        const match = nextGroupLetters.find(
                          (l) => l.variant === action.next_letter_variant
                        );
                        return match?.content_id ?? action.next_letter_variant;
                      })()}
                    />
                  ) : null
                }
                items={[
                  {
                    key: "__unset",
                    label: <span className="text-muted-foreground">(Unset)</span>,
                    active: !action.next_letter_variant,
                    onPick: () => onChange({ next_letter_variant: null }),
                  },
                  ...(nextGroup
                    ? nextGroupLetters
                        .filter((l) => l.variant)
                        .map((l) => ({
                          key: l.id,
                          active: action.next_letter_variant === l.variant,
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
                          onPick: () =>
                            onChange({ next_letter_variant: l.variant }),
                        }))
                    : []),
                  nextGroup
                    ? {
                        key: "__new_letter",
                        muted: true,
                        label: "+ Letter",
                        onPick: () =>
                          startCreateLetter(async () => {
                            const { variant } = await createLetterInNextGroup(
                              groupId
                            );
                            onChange({ next_letter_variant: variant });
                          }),
                      }
                    : {
                        key: "__new_group_and_letter",
                        muted: true,
                        label: "+ Letter Group + Letter",
                        onPick: () =>
                          startCreateLetter(async () => {
                            const { variant } =
                              await createNextLetterGroupAndLetter(groupId);
                            onChange({ next_letter_variant: variant });
                          }),
                      },
                ]}
              />
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Report
          </span>
          <div className="flex h-7 w-full items-center gap-1">
            {creatingSegment ? (
              <CreatingPill />
            ) : (
              <PillSelect
                pill={(() => {
                  const seg = action.report_segment_id
                    ? segments.find((s) => s.id === action.report_segment_id)
                    : null;
                  return seg ? (
                    <ReportSegmentPill
                      storyline={storyline}
                      reportId={seg.report_id}
                    />
                  ) : null;
                })()}
                items={[
                  {
                    key: "__unset",
                    label: <span className="text-muted-foreground">(Unset)</span>,
                    active: !action.report_segment_id,
                    onPick: () => onChange({ report_segment_id: null }),
                  },
                  ...segments.map((s) => ({
                    key: s.id,
                    active: action.report_segment_id === s.id,
                    label: (
                      <ReportSegmentPill
                        storyline={storyline}
                        reportId={s.report_id}
                      />
                    ),
                    onPick: () => onChange({ report_segment_id: s.id }),
                  })),
                  {
                    key: "__new_segment",
                    muted: true,
                    label: "+ Report Segment",
                    onPick: () =>
                      startCreateSegment(async () => {
                        if (currentDay && !nextDay) {
                          const { segmentId } =
                            await createNextDayAndReportSegment(
                              groupId,
                              currentDay.number
                            );
                          onChange({ report_segment_id: segmentId });
                        } else {
                          const { segmentId } =
                            await createReportSegmentForGroup(
                              groupId,
                              nextDay?.id ?? null
                            );
                          onChange({ report_segment_id: segmentId });
                        }
                      }),
                  },
                ]}
              />
            )}
            {action.report_segment_id ? (
              <button
                type="button"
                onClick={onOpenSegment}
                aria-label="Open report segment"
                title="Open report segment"
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                  segmentOpen
                    ? "border-foreground/60 bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <svg
                  width="14"
                  height="14"
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
            ) : null}
          </div>
        </div>
      </div>

      {/* Impact variables label. */}
      <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Impact variables
      </div>

      {/* Three grouped boxes: [class affinities] [nation affinities]
          [world]. Each box is slightly darker than the card so the
          groups read as separate without divider lines. */}
      <div className="mt-1 flex flex-wrap items-start gap-1.5">
        <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
          {CLASS_AFFINITY.map((c) => (
            <ClassTile
              key={c.key}
              label={c.label}
              icon={c.icon}
              value={action[c.key]}
              onChange={(v) =>
                onChange({ [c.key]: v } as Partial<ActionState>)
              }
            />
          ))}
        </div>
        <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
          {orderedNations.map((n) => {
            const key = NATION_IMPACT_KEYS[n.name.toLowerCase()];
            return (
              <NationTile
                key={n.id}
                nation={n}
                value={action[key]}
                onChange={(v) =>
                  onChange({ [key]: v } as Partial<ActionState>)
                }
              />
            );
          })}
        </div>
        <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
          <ClassTile
            label="Demerits"
            icon={
              <IconCircleMinus
                size={14}
                aria-hidden
                className="text-red-500"
              />
            }
            value={action.impact_demerits}
            onChange={(v) =>
              onChange({ impact_demerits: v } as Partial<ActionState>)
            }
          />
          <ClassTile
            label="World Status"
            icon={
              <IconWorldBolt
                size={14}
                aria-hidden
                className="text-cyan-400"
              />
            }
            value={action.impact_world_status}
            onChange={(v) =>
              onChange({ impact_world_status: v } as Partial<ActionState>)
            }
          />
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <DeleteButton onClick={onDelete} />
      </div>
    </div>
  );
}

function CounterInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div className="group flex flex-col items-center gap-0.5">
      <Input
        type="text"
        inputMode="numeric"
        value={value === 0 ? "" : String(value)}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          if (raw === "" || raw === "-") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        className={cn(
          "h-6 w-9 px-1 text-center placeholder:text-muted-foreground/70",
          GHOST_FIELD
        )}
      />
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          tabIndex={-1}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Decrease"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          tabIndex={-1}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ClassTile({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <span
        aria-label={label}
        className="flex h-6 items-center text-muted-foreground"
      >
        {icon ?? <span className="text-[10px]">{label}</span>}
      </span>
      <CounterInput value={value} onChange={onChange} orientation="vertical" />
    </div>
  );
}

function NationTile({
  nation,
  value,
  onChange,
}: {
  nation: Nation;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1" title={nation.name}>
      <span
        className="flex h-6 w-6 items-center justify-center"
        style={{ color: nation.color_hex }}
        aria-label={nation.name}
      >
        {nation.icon_value ? (
          <IconDisplay
            type={nation.icon_type}
            value={nation.icon_value}
            size={14}
          />
        ) : (
          <span className="text-[10px] font-mono">
            {nation.abbreviation ?? nation.name.slice(0, 1)}
          </span>
        )}
      </span>
      <CounterInput value={value} onChange={onChange} orientation="vertical" />
    </div>
  );
}

function BackLink({ onNavigate }: { onNavigate: () => void }) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      aria-label="Back to inspection letters"
      title="Back to inspection letters"
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

/**
 * Deduplicate paired templates into single picker entries labeled "A + B".
 * The lower-sort_order template acts as the canonical id for the pair;
 * addActionFromTemplate handles the pair insertion server-side.
 */
function pickerEntries(
  templates: ActionTemplate[]
): Array<{ id: string; label: string }> {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const entries: Array<{ id: string; label: string }> = [];
  for (const t of templates) {
    if (seen.has(t.id)) continue;
    const partner = t.paired_template_id
      ? byId.get(t.paired_template_id)
      : undefined;
    if (partner) {
      const [a, b] =
        t.sort_order <= partner.sort_order ? [t, partner] : [partner, t];
      entries.push({ id: a.id, label: `${a.name} + ${b.name}` });
      seen.add(a.id);
      seen.add(b.id);
    } else {
      entries.push({ id: t.id, label: t.name });
      seen.add(t.id);
    }
  }
  return entries;
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
  onPick: () => void;
};

/**
 * Dropdown whose trigger renders an arbitrary pill (or nothing when empty).
 * Used so the Action editor's Next-letter / Report fields can display the
 * same standard pill styling as the rest of the app instead of a styled
 * native <select>. The dropdown menu itself falls back to text labels.
 */
function PillSelect({
  pill,
  items,
  triggerClassName,
  menuClassName,
}: {
  pill: React.ReactNode | null;
  items: PillSelectItem[];
  triggerClassName?: string;
  menuClassName?: string;
}) {
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
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-6 items-center rounded-md",
          pill ? "" : "min-w-[24px] border border-dashed border-border/40",
          triggerClassName
        )}
      >
        {pill}
      </button>
      {open ? (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-20 mt-1 min-w-[180px] max-h-64 overflow-auto rounded-md border border-border bg-card shadow-md",
            menuClassName
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={!!item.active}
              onClick={() => {
                item.onPick();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs hover:bg-accent/40",
                item.active && "bg-accent/30",
                item.muted && "text-muted-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
type UnsavedOutcome = "save" | "discard" | "cancel";

/**
 * Tri-state dialog for unsaved changes. Returns "save", "discard", or
 * "cancel". Used by the breadcrumb / leave flow to ask once per dirty
 * panel — pressing Cancel aborts the whole navigation, Save flushes
 * that panel and continues, Don't save drops its edits and continues.
 */
function useUnsavedDialog(): {
  ask: (title: string, message?: string) => Promise<UnsavedOutcome>;
  dialog: React.ReactNode;
} {
  const [state, setState] = useState<{ title: string; message?: string } | null>(
    null
  );
  const resolveRef = useRef<((v: UnsavedOutcome) => void) | null>(null);

  const ask = useCallback(
    (title: string, message?: string) =>
      new Promise<UnsavedOutcome>((resolve) => {
        resolveRef.current = resolve;
        setState({ title, message });
      }),
    []
  );

  function settle(v: UnsavedOutcome) {
    const r = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    r?.(v);
  }

  const dialog = state ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
      onClick={() => settle("cancel")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {state.title}
        </h3>
        {state.message ? (
          <p className="mt-3 text-sm text-foreground/90">{state.message}</p>
        ) : null}
        <div className="mt-6 flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => settle("discard")}
          >
            Don&rsquo;t save
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => settle("cancel")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => settle("save")}
              autoFocus
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}

function PanelHeader({
  title,
  dirty,
  showSaved,
  saveRevert,
  menu,
}: {
  title: string;
  dirty?: boolean;
  showSaved?: boolean;
  /** Optional Save / Revert pair; renders between the dirty indicator
   *  and the overflow menu. Hidden when no SaveRevert is supplied. */
  saveRevert?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3 py-1.5">
      <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
  onClick: () => void;
  intent?: "default" | "destructive";
  icon?: React.ReactNode;
};

function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
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
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
          className="absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-accent/40",
                item.intent === "destructive"
                  ? "text-destructive"
                  : "text-foreground"
              )}
            >
              {item.icon}
              {item.label}
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
 * Icon-only save + revert pair. Revert is guarded with a confirm modal when
 * the field is dirty. The pair is hidden entirely until there are unsaved
 * changes (or a save is in flight).
 */
function SaveRevert({
  dirty,
  pending,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  if (!dirty && !pending) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onRevert}
        disabled={pending}
        aria-label="Revert to saved"
        title="Revert to saved"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconRestore size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        aria-label="Save"
        title="Save"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Spinner /> : <Save size={14} aria-hidden />}
      </button>
    </div>
  );
}

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
 * Owns its own dirty flag so the workspace can include it in breadcrumb /
 * switch-group guards via the `dirty` + `onDirtyChange` pair.
 */
function StorylineInspector({
  storyline,
  groups,
  allLetters,
  days,
  dirty,
  selectedGroupId,
  onDirtyChange,
  onBack,
  onSelectGroup,
  onDeselectGroup,
  onConfirmDialog,
}: {
  storyline: Storyline;
  groups: LetterGroup[];
  allLetters: InspectionLetterView[];
  days: Day[];
  dirty: boolean;
  selectedGroupId: string | null;
  onDirtyChange: (d: boolean) => void;
  onBack: () => void;
  onSelectGroup: (id: string) => void;
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
  const [state, setState] = useState(() => ({
    name: storyline.name,
    abbreviation: storyline.abbreviation,
    description: storyline.description,
    icon_type: storyline.icon_type,
    icon_value: storyline.icon_value,
    color_hex: storyline.color_hex,
  }));
  const [pending, startSave] = useTransition();
  const [rowPending, startRowAction] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setState({
      name: storyline.name,
      abbreviation: storyline.abbreviation,
      description: storyline.description,
      icon_type: storyline.icon_type,
      icon_value: storyline.icon_value,
      color_hex: storyline.color_hex,
    });
    onDirtyChange(false);
    setPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyline.id]);

  function update<K extends keyof typeof state>(k: K, v: (typeof state)[K]) {
    setState((s) => ({ ...s, [k]: v }));
    onDirtyChange(true);
  }

  async function saveNow() {
    await updateStorylineFields({
      id: storyline.id,
      name: state.name,
      abbreviation: state.abbreviation,
      description: state.description,
      icon_type: state.icon_type,
      icon_value: state.icon_value,
      color_hex: state.color_hex,
    });
    onDirtyChange(false);
  }

  async function revert() {
    if (!dirty) return;
    const ok = await onConfirmDialog({
      title: "Discard storyline changes?",
      message: "Any unsaved edits will be lost.",
      confirmLabel: "Revert",
      intent: "destructive",
    });
    if (!ok) return;
    setState({
      name: storyline.name,
      abbreviation: storyline.abbreviation,
      description: storyline.description,
      icon_type: storyline.icon_type,
      icon_value: storyline.icon_value,
      color_hex: storyline.color_hex,
    });
    onDirtyChange(false);
  }

  function handleAddGroup() {
    startRowAction(async () => {
      const { groupId } = await createLetterGroupInStoryline(storyline.id);
      onSelectGroup(groupId);
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
        dirty={dirty || orderDirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty}
            pending={pending}
            onSave={() => startSave(saveNow)}
            onRevert={revert}
          />
        }
      />
      <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <BackLink onNavigate={onBack} />
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
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
        <Input
          value={state.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Storyline name"
          className={cn(
            "h-7 flex-1 px-1 text-base font-semibold text-foreground",
            GHOST_FIELD
          )}
        />
        <Label
          htmlFor="storyline-abbr"
          className="shrink-0 self-center"
        >
          Abbr
        </Label>
        <Input
          id="storyline-abbr"
          value={state.abbreviation}
          onChange={(e) =>
            update(
              "abbreviation",
              e.target.value.toUpperCase().slice(0, 1)
            )
          }
          maxLength={1}
          className={cn(
            "h-7 w-7 shrink-0 px-0 text-center font-mono text-xs uppercase",
            GHOST_FIELD
          )}
        />
      </div>

      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-6 flex flex-col gap-1">
          <Label>Description</Label>
          <AutoTextarea
            value={state.description ?? ""}
            onChange={(e) =>
              update("description", e.target.value || null)
            }
            minRows={2}
            className={GHOST_FIELD}
          />
        </div>
      </div>

      {pickerOpen ? (
        <div className="mt-3 rounded-md border border-border bg-accent/10 px-3 py-3">
          <IconPicker
            initialType={state.icon_type}
            initialValue={state.icon_value}
            emitHiddenFields={false}
            onChange={(next) => {
              setState((s) => ({
                ...s,
                icon_type: next.type,
                icon_value: next.value || null,
              }));
              onDirtyChange(true);
            }}
            color={state.color_hex}
            onColorChange={(c) => update("color_hex", c)}
          />
        </div>
      ) : null}

      <div className="mt-4 rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Letter groups ({sortedGroups.length})
          </span>
          <div className="flex items-center gap-2">
            {orderDirty ? (
              <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
                • Unsaved
              </span>
            ) : null}
            <SaveRevert
              dirty={orderDirty}
              pending={reorderPending}
              onSave={saveReorder}
              onRevert={() => setPendingOrder(sortedGroups.map((g) => g.id))}
            />
            <button
              type="button"
              onClick={() => (reorderMode ? cancelReorder() : beginReorder())}
              disabled={sortedGroups.length < 2}
              aria-pressed={reorderMode}
              aria-label={reorderMode ? "Lock order" : "Unlock to reorder"}
              title={reorderMode ? "Lock order" : "Unlock to reorder"}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ReorderIcon active={reorderMode} />
            </button>
          </div>
        </div>
        <div className="flex flex-col">
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
        {!reorderMode ? (
          <div className="flex justify-center border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={handleAddGroup}
              disabled={rowPending}
              className={MUTED_ADD_BTN}
            >
              {rowPending ? <Spinner /> : "+ Letter group"}
            </button>
          </div>
        ) : null}
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
    <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[10px] font-mono uppercase tracking-wider">
      {(["storyline", "day"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setGroupMode(m)}
          aria-pressed={groupMode === m}
          className={cn(
            "rounded px-2 py-1 transition-colors",
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

  function renderGroupRow(g: LetterGroup, opts: { showStoryline: boolean }) {
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
              "flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm",
              !active && "hover:bg-accent/30"
            )}
          >
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
            <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
              {count} L
            </span>
            <span className="w-10 shrink-0 text-right">
              {day ? (
                <span className="inline-flex items-center rounded-full bg-foreground/15 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {day.identifier}
                </span>
              ) : (
                <span className="font-mono text-[10px] text-muted-foreground/40">
                  —
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggle(groupKey)}
            aria-expanded={groupOpen}
            aria-label={groupOpen ? "Hide letters" : "Show letters"}
            className="inline-flex w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent/30 hover:text-foreground"
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
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{ModeToggle}</div>

      {groupMode === "storyline"
        ? storylines.map((s) => {
            const bucket = groupsByStoryline.get(s.id) ?? [];
            const open = openBuckets.has(s.id);
            const headerActive = s.id === selectedStorylineId;
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
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left"
                    title={headerActive ? `Close ${s.name}` : `Open ${s.name}`}
                  >
                    <StorylinePill storyline={s} className="min-w-0 flex-1" />
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {bucket.length}
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
                      renderGroupRow(g, { showStoryline: false })
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
          })
        : dayBuckets.map(({ key, day, groups: bucket }) => {
            const open = openBuckets.has(`day:${key}`);
            return (
              <div
                key={key}
                className="overflow-hidden rounded-md border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggle(`day:${key}`)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30"
                >
                  <span className="flex-1 truncate text-sm font-semibold">
                    {day
                      ? `Day ${day.number}${day.identifier ? ` · ${day.identifier}` : ""}`
                      : "Unscheduled"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {bucket.length}
                  </span>
                  <ChevronLeft
                    size={12}
                    aria-hidden
                    className={cn(
                      "text-muted-foreground transition-transform",
                      open && "-rotate-90"
                    )}
                  />
                </button>
                {open ? (
                  <div className="flex flex-col border-t border-border">
                    {bucket.map((g) =>
                      renderGroupRow(g, { showStoryline: true })
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
  );
}
