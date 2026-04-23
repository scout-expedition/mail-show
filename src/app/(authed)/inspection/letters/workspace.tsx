"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
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
  saveGroup,
  saveLetterWithActions,
  saveReportSegment,
  updateCitizen,
} from "./actions";
import { usePathname, useRouter } from "next/navigation";
import { groupSlug, parseGroupSlug } from "@/lib/letter-groups";
import { useConfirm } from "@/components/confirm-dialog";
import {
  ChevronRight,
  MailOpen,
  Mails,
  Megaphone,
  Milestone,
  Save,
  Trash2,
} from "lucide-react";
import { IconRestore } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";

/** Plain-text-until-focused look for fields — mirrors the citizens page. */
const GHOST_FIELD =
  "border-transparent bg-transparent shadow-none hover:bg-accent/20 focus:border-border focus-visible:bg-input focus-visible:shadow-sm";

const CLASS_AFFINITY: Array<{ key: keyof ActionImpacts; label: string }> = [
  { key: "impact_proletariat", label: "Proletariat" },
  { key: "impact_gentry", label: "Gentry" },
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

  const siblingGroups = useMemo(() => {
    if (!group) return [];
    return allGroups
      .filter((g) => g.storyline_id === group.storyline_id)
      .sort((a, b) => a.sequence - b.sequence);
  }, [allGroups, group]);

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
  const [rowPending, startRowAction] = useTransition();
  const [view, setView] = useState<"groups" | "main" | "actions" | "segment">(
    initialSegmentId
      ? "segment"
      : initialLetterId
        ? "main"
        : "groups"
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
      message: "Any unsaved edits to this letter (and its actions) will be lost.",
      confirmLabel: "Revert",
      intent: "destructive",
    });
    if (!ok) return;
    const server = letters.find((l) => l.id === letterState.id);
    if (server) setLetterState(toLetterState(server, actions));
    setLetterDirty(false);
  }

  function selectGroup(id: string | null) {
    if (id === selectedGroupId) {
      // Toggle off — close group panel.
      if (groupDirty || letterDirty) {
        const ok = confirm(
          "Unsaved changes will be lost. Close anyway?"
        );
        if (!ok) return;
      }
      setSelectedGroupId(null);
      setSelectedId(null);
      setLetterState(null);
      setLetterDirty(false);
      setGroupDirty(false);
      setSelectedSegmentId(null);
      setView("groups");
      return;
    }
    if (groupDirty || letterDirty) {
      const ok = confirm(
        "Unsaved changes will be lost. Switch groups anyway?"
      );
      if (!ok) return;
    }
    setSelectedGroupId(id);
    setSelectedId(null);
    setLetterState(null);
    setLetterDirty(false);
    setGroupDirty(false);
    setSelectedSegmentId(null);
    // Picking a group just opens it in the right-side slot — don't slide.
    // The slide happens when a letter inside is opened.
    setView("groups");
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
    if (!letterDirty) {
      setLetterState(toLetterState(found, actions));
    }
  }, [letters, actions, selectedId, letterDirty]);

  function selectLetter(id: string) {
    if (id === selectedId) {
      // Toggle off — deselect the current letter so the right panel clears.
      if (letterDirty) {
        const ok = confirm(
          "This letter has unsaved changes. Discard them and close?"
        );
        if (!ok) return;
      }
      setSelectedId(null);
      setLetterState(null);
      setLetterDirty(false);
      setView("groups");
      setSelectedSegmentId(null);
      return;
    }
    if (letterDirty) {
      const ok = confirm(
        "This letter has unsaved changes. Discard them and switch?"
      );
      if (!ok) return;
    }
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    setSelectedId(id);
    setLetterState(toLetterState(l, actions));
    setLetterDirty(false);
    setView("main");
    setSelectedSegmentId(null);
  }

  function closeActionsPanel() {
    if (letterDirty) {
      const ok = confirm(
        "Actions have unsaved changes. Save before closing?"
      );
      if (ok && letterState) {
        const snap = letterState;
        startLetterSave(async () => {
          await saveLetterNow(snap);
          setLetterDirty(false);
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
   * segments" list. Clears the current letter selection so the actions slot
   * (panel 3, visible at view="segment") doesn't show stale actions for a
   * letter the user isn't editing.
   */
  async function openSegmentFromGroup(segmentId: string) {
    if (letterDirty) {
      const ok = await confirmDialog({
        title: "Discard letter changes?",
        message:
          "The open letter has unsaved edits. Opening the report segment will discard them.",
        confirmLabel: "Discard",
        intent: "destructive",
      });
      if (!ok) return;
      setLetterDirty(false);
    }
    setSelectedId(null);
    setSelectedSegmentId(segmentId);
    setView("segment");
  }

  function closeSegmentPanel(segmentDirty: boolean, onSave: () => Promise<void>) {
    if (segmentDirty) {
      const ok = confirm(
        "Segment has unsaved changes. Save before closing?"
      );
      if (ok) {
        startRowAction(async () => {
          await onSave();
          setView("actions");
          setSelectedSegmentId(null);
        });
        return;
      }
    }
    setView("actions");
    setSelectedSegmentId(null);
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
    setLetterDirty(true);
  }

  async function saveLetterNow(state: LetterState) {
    if (!group) return;
    await saveLetterWithActions(
      group.id,
      {
        id: state.id,
        piece: state.piece,
        delivery_day_override_id: state.delivery_day_override_id,
        summary: state.summary,
        content: state.content,
        sender_citizen_id: state.sender_citizen_id,
        receiver_citizen_id: state.receiver_citizen_id,
        notes: state.notes,
      },
      state.actions.map((a) => ({
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
      }))
    );
  }

  function handleSaveLetter() {
    if (!letterState) return;
    const state = letterState;
    startLetterSave(async () => {
      await saveLetterNow(state);
      setLetterDirty(false);
    });
  }

  function handleSaveGroup() {
    if (!group) return;
    const groupId = group.id;
    let alsoSaveLetter = false;
    if (letterDirty && letterState) {
      alsoSaveLetter = confirm(
        "The open letter has unsaved changes. Save the letter too?"
      );
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
      }
    });
  }

  function handleAddLetters(count: number) {
    if (!group) return;
    const groupId = group.id;
    if (letterDirty) {
      const ok = confirm(
        "The open letter has unsaved changes. Discard them and add?"
      );
      if (!ok) return;
    }
    startRowAction(async () => {
      const ids = await createInspectionLettersInGroup(groupId, count);
      if (ids[0]) setSelectedId(ids[0]);
      setLetterDirty(false);
    });
  }

  function handleAddPiece(letterId: string) {
    if (!group) return;
    const groupId = group.id;
    if (letterDirty) {
      const ok = confirm(
        "The open letter has unsaved changes. Discard them and add a piece?"
      );
      if (!ok) return;
    }
    startRowAction(async () => {
      const { newLetterId } = await addPieceToLetter(groupId, letterId);
      setSelectedId(newLetterId);
      setLetterDirty(false);
    });
  }

  function handleDeleteLetter(id: string) {
    if (!group) return;
    const groupId = group.id;
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    if (!confirm(`Delete letter ${l.content_id}? This cannot be undone.`))
      return;
    startRowAction(async () => {
      await deleteInspectionLetter(groupId, id);
      if (selectedId === id) {
        setSelectedId(null);
        setLetterState(null);
        setLetterDirty(false);
      }
    });
  }

  function handleDeleteGroup() {
    if (!group) return;
    const groupId = group.id;
    if (
      !confirm(
        `Delete letter group "${group.name}" and all of its letters? This cannot be undone.`
      )
    )
      return;
    startGroupSave(async () => {
      await deleteGroup(groupId);
    });
  }

  function handleAddAction(templateId: string) {
    if (!group) return;
    const groupId = group.id;
    if (!selectedId || !templateId) return;
    if (letterDirty) {
      const ok = confirm(
        "This letter has unsaved changes. Save them before adding an action? (Cancel to discard.)"
      );
      if (ok && letterState) {
        const snap = letterState;
        startRowAction(async () => {
          await saveLetterNow(snap);
          await addActionFromTemplate(groupId, selectedId, templateId);
          setLetterDirty(false);
        });
        return;
      }
    }
    startRowAction(async () => {
      await addActionFromTemplate(groupId, selectedId!, templateId);
      setLetterDirty(false);
    });
  }

  function handleDeleteAction(actionId: string) {
    if (!group) return;
    const groupId = group.id;
    if (!confirm("Delete this action? This cannot be undone.")) return;
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

  const currentStoryline = storylineById.get(groupState.storyline_id);

  const selectedLetter = selectedId
    ? letters.find((l) => l.id === selectedId)
    : null;
  const selectedSegment = selectedSegmentId
    ? segments.find((s) => s.id === selectedSegmentId)
    : null;

  async function goToBreadcrumb(level: "root" | "group" | "letter" | "actions") {
    // Closing a panel discards all open panels below. If any are dirty,
    // confirm first; a single dirty blocker covers the whole stack.
    const willLoseDirty =
      level === "root"
        ? groupDirty || letterDirty
        : level === "group"
          ? letterDirty
          : false;
    if (willLoseDirty) {
      const ok = await confirmDialog({
        title: "Discard unsaved changes?",
        message:
          "There are unsaved edits in one or more panels. Close them anyway?",
        confirmLabel: "Discard",
        intent: "destructive",
      });
      if (!ok) return;
    }
    if (level === "root") {
      setSelectedGroupId(null);
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setGroupDirty(false);
      setLetterDirty(false);
      setView("groups");
    } else if (level === "group") {
      setSelectedId(null);
      setLetterState(null);
      setSelectedSegmentId(null);
      setLetterDirty(false);
      setView("groups");
    } else if (level === "letter") {
      setSelectedSegmentId(null);
      setView("main");
    } else if (level === "actions") {
      setSelectedSegmentId(null);
      setView("actions");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-3 font-mono text-sm text-muted-foreground">
        <BreadcrumbLink onClick={() => goToBreadcrumb("root")}>
          Inspection Letters
        </BreadcrumbLink>
        {currentStoryline ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              onClick={() => goToBreadcrumb("group")}
              color={currentStoryline.color_hex}
            >
              {currentStoryline.name}
            </BreadcrumbLink>
          </>
        ) : null}
        {group ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              onClick={() => goToBreadcrumb("group")}
              active={view === "groups"}
              icon={<Mails size={12} aria-hidden />}
            >
              {currentStoryline?.abbreviation ?? ""}
              {group.sequence}
            </BreadcrumbLink>
          </>
        ) : null}
        {selectedLetter ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              onClick={() => goToBreadcrumb("letter")}
              active={view === "main"}
              icon={<MailOpen size={12} aria-hidden />}
            >
              {selectedLetter.content_id}
            </BreadcrumbLink>
          </>
        ) : null}
        {view === "actions" || view === "segment" ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              onClick={() => goToBreadcrumb("actions")}
              active={view === "actions"}
              icon={<Milestone size={12} aria-hidden />}
            >
              Actions
            </BreadcrumbLink>
          </>
        ) : null}
        {selectedSegment ? (
          <>
            <ChevronRight size={12} aria-hidden className="opacity-50" />
            <BreadcrumbLink
              active={view === "segment"}
              icon={<Megaphone size={12} aria-hidden />}
            >
              {selectedSegment.report_id.toLowerCase()}
            </BreadcrumbLink>
          </>
        ) : null}
      </div>

      <div className="relative overflow-hidden">
        <div
          className={cn(
            "flex transition-transform duration-300 ease-out",
            view === "main" && "-translate-x-[20%]",
            view === "actions" && "-translate-x-[40%]",
            view === "segment" && "-translate-x-[60%]"
          )}
          style={{ width: "250%" }}
        >
        {/* STORYLINES slot: list of groups grouped by storyline */}
        <div className="flex w-1/5 shrink-0 flex-col gap-4 pr-3">
          <StorylinesListPanel
            storylines={storylines}
            groups={allGroups}
            letters={allLetters}
            days={days}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(id) => selectGroup(id)}
          />
        </div>

        {/* GROUP slot: group info + letter list */}
        <div className="flex w-1/5 shrink-0 flex-col gap-4 px-3">
          {!group ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Select a letter group on the left to open it.
            </div>
          ) : (
          <>
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <BackLink onNavigate={() => selectGroup(null)} />
                <Mails size={14} aria-hidden className="text-muted-foreground/70" />
                <GroupIdSwitcher
                  current={group}
                  currentAbbr={currentStoryline?.abbreviation ?? "?"}
                  siblings={siblingGroups}
                  onPick={(slug) => {
                    // Find sibling by slug in state and switch without navigating.
                    const parsed = parseGroupSlug(slug);
                    if (!parsed) return;
                    const s = storylines.find(
                      (x) => x.abbreviation === parsed.abbreviation
                    );
                    if (!s) return;
                    const target = allGroups.find(
                      (g) =>
                        g.storyline_id === s.id &&
                        g.sequence === parsed.sequence
                    );
                    if (target) selectGroup(target.id);
                  }}
                />
                {groupState.name || (
                  <span className="text-muted-foreground italic">(unnamed)</span>
                )}
              </h3>
              <SaveRevert
                dirty={groupDirty}
                pending={groupPending}
                onSave={handleSaveGroup}
                onRevert={revertGroup}
              />
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3 flex flex-col gap-1">
                <Label>Storyline</Label>
                <span className="flex h-8 items-center truncate px-2 font-mono text-sm text-muted-foreground">
                  {currentStoryline?.name ?? "—"}
                </span>
              </div>
              <div className="col-span-3 flex flex-col gap-1">
                <Label>Name</Label>
                <Input
                  value={groupState.name}
                  onChange={(e) => updateGroup("name", e.target.value)}
                  className={cn("h-8", GHOST_FIELD)}
                />
              </div>
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
                <Textarea
                  value={groupState.notes ?? ""}
                  onChange={(e) => updateGroup("notes", e.target.value || null)}
                  rows={2}
                  className={GHOST_FIELD}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <DeleteButton onClick={handleDeleteGroup} disabled={groupPending} />
            </div>
          </div>

          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Letters ({letters.length})
              </span>
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
                    onDragEnd={() => {
                      const finalOrder = orderOverride;
                      setDragIndex(null);
                      if (!finalOrder) return;
                      startRowAction(async () => {
                        await reorderInspectionLetters(group.id, finalOrder);
                      });
                    }}
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
                      className="flex flex-1 items-center gap-2 text-left disabled:cursor-grab"
                    >
                      <Badge variant="secondary" className="font-mono">
                        {l.content_id}
                      </Badge>
                      <span className="truncate text-sm">
                        {l.summary || (
                          <span className="text-muted-foreground italic">
                            (no summary)
                          </span>
                        )}
                      </span>
                      {active && letterDirty ? (
                        <span className="ml-auto text-xs text-warning">•</span>
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

          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
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
                    <Badge variant="secondary" className="font-mono">
                      {seg.report_id.toLowerCase()}
                    </Badge>
                    <span className="truncate text-sm">
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
          </>
          )}
        </div>

        {/* LETTER slot: fields only */}
        <div className="flex w-1/5 shrink-0 flex-col gap-4 px-3">
          {letterState ? (
            <LetterFieldsCard
              key={letterState.id}
              state={letterState}
              letterView={letters.find((l) => l.id === letterState.id)!}
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
              onSave={handleSaveLetter}
              onRevert={revertLetter}
              onDelete={() => handleDeleteLetter(letterState.id)}
              actionsCount={letterState.actions.length}
              actionsActive={view === "actions"}
              onShowActions={() => setView("actions")}
            />
          ) : (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Select a letter to edit, or add one.
            </div>
          )}
        </div>

        {/* ACTIONS slot: action editors, shown by sliding */}
        <div className="flex w-1/5 shrink-0 flex-col gap-4 px-3">
          {letterState ? (
            <LetterActionsCard
              key={letterState.id}
              actions={letterState.actions}
              templates={templates}
              nations={nations}
              segments={segments}
              nextGroup={nextGroup}
              nextGroupLetters={nextGroupLetters}
              groupId={group?.id ?? ""}
              days={days}
              currentLetterDayId={
                letterState.delivery_day_override_id ??
                groupState.delivery_day_id
              }
              dirty={letterDirty}
              pending={letterPending}
              rowPending={rowPending}
              onActionChange={updateAction}
              onAddAction={handleAddAction}
              onDeleteAction={handleDeleteAction}
              onOpenSegment={openSegmentForAction}
              openSegmentId={selectedSegmentId}
              onSave={handleSaveLetter}
              onRevert={revertLetter}
              onBack={closeActionsPanel}
            />
          ) : null}
        </div>

        {/* SEGMENT slot: selected report segment */}
        <div className="flex w-1/5 shrink-0 flex-col gap-4 pl-3">
          {letterState && selectedSegmentId ? (
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
              onBack={closeSegmentPanel}
              onDelete={handleDeleteSegment}
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
    </div>
  );
}

function LetterFieldsCard({
  state,
  letterView,
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
  actionsCount,
  actionsActive,
  onShowActions,
}: {
  state: LetterState;
  letterView: InspectionLetterView;
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
  actionsCount: number;
  actionsActive: boolean;
  onShowActions: () => void;
}) {
  // The "Delivery Day" dropdown: value is the override; falls back to group day implicitly.
  const currentDayId = state.delivery_day_override_id ?? groupDeliveryDayId;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <MailOpen size={14} aria-hidden className="text-muted-foreground/70" />
          <Badge variant="secondary">{letterView.content_id}</Badge>
          {dirty ? (
            <span className="text-warning">• unsaved</span>
          ) : (
            <span className="text-muted-foreground/70">saved</span>
          )}
        </h3>
        <SaveRevert
          dirty={dirty}
          pending={pending}
          onSave={onSave}
          onRevert={onRevert}
        />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-4 flex flex-col gap-1">
          <Label>Delivery Override</Label>
          <DaySelect
            value={currentDayId ?? ""}
            days={days}
            groupDefaultId={groupDeliveryDayId}
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
        <div className="col-span-2 flex flex-col justify-end">
          <button
            type="button"
            onClick={onShowActions}
            aria-label="Show actions"
            title="Show actions"
            aria-pressed={actionsActive}
            className={cn(
              "flex h-8 items-center justify-between gap-2 rounded-md border px-3 text-xs transition-colors",
              actionsActive
                ? "border-foreground/60 bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span>Actions ({actionsCount})</span>
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

      <div className="mt-4 flex justify-center">
        <DeleteButton onClick={onDelete} />
      </div>
      <LastUpdatedFooter at={letterView.updated_at} by={letterView.updated_by} />
    </div>
  );
}

function LetterActionsCard({
  actions,
  templates,
  nations,
  segments,
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
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
            {dirty ? (
              <span className="text-warning">• unsaved</span>
            ) : (
              <span className="text-muted-foreground/70">saved</span>
            )}
          </h4>
        </div>
        <SaveRevert
          dirty={dirty}
          pending={pending}
          onSave={onSave}
          onRevert={onRevert}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTemplatePickerOpen(true)}
              disabled={rowPending || templates.length === 0}
            >
              + Action
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LetterSegmentCard({
  segment,
  days,
  groupDeliveryDayId,
  onBack,
  onDelete,
  onConfirmDialog,
}: {
  segment: ReportSegmentView | null;
  days: Day[];
  groupDeliveryDayId: string | null;
  onBack: (
    dirty: boolean,
    onSave: () => Promise<void>
  ) => void;
  onDelete: (segmentId: string) => void;
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

  if (!segment) {
    return (
      <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Segment not available.
      </div>
    );
  }

  const currentDayId = state.delivery_day_override_id;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
            <Megaphone
              size={14}
              aria-hidden
              className="text-muted-foreground/70"
            />
            <Badge variant="secondary">{segment.report_id.toLowerCase()}</Badge>
            {dirty ? (
              <span className="text-warning">• unsaved</span>
            ) : (
              <span className="text-muted-foreground/70">saved</span>
            )}
          </h3>
        </div>
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
            value={currentDayId ?? ""}
            days={days}
            groupDefaultId={groupDeliveryDayId}
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
      <div className="mt-4 flex justify-center">
        <DeleteButton
          onClick={async () => {
            const ok = await onConfirmDialog({
              title: "Delete report segment?",
              message: `Segment ${segment.report_id.toLowerCase()} will be removed from the report. This cannot be undone.`,
              confirmLabel: "Delete",
              intent: "destructive",
            });
            if (!ok) return;
            onDelete(segment.id);
          }}
        />
      </div>
      <LastUpdatedFooter at={segment.updated_at} by={segment.updated_by} />
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
      <div className="flex gap-1">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search citizens"
          className={cn("h-8 flex-1", GHOST_FIELD)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreate}
          title="Create new hero"
        >
          +
        </Button>
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
      className="flex flex-col"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <div
        className={cn(
          "flex items-center gap-1 overflow-hidden rounded-t-md border border-border bg-muted/40 transition-all duration-150 ease-out",
          focused
            ? "max-h-8 border-b-0 px-1.5 py-1 opacity-100"
            : "pointer-events-none max-h-0 border-transparent px-0 py-0 opacity-0"
        )}
        aria-hidden={!focused}
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
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
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
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
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
      <Textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // Keep focused if a toolbar button (in the sibling div) takes focus.
          const next = e.relatedTarget as Node | null;
          const container = (e.currentTarget.parentElement?.parentElement) ?? null;
          if (!container || !next || !container.contains(next)) {
            setFocused(false);
          }
        }}
        rows={minRows}
        className={cn(
          "resize-none overflow-hidden",
          focused && "rounded-t-none",
          className
        )}
      />
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
      >
        {pending ? (
          <>
            <Spinner />
            Working…
          </>
        ) : (
          "+ Inspection Letter"
        )}
      </Button>
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
    <div className="rounded-md border border-border p-3">
      {/* Top row: icon, name, Next letter, Report, delete */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
            style={{ background: colorHex, color: "#fff" }}
          >
            {iconValue ? (
              <IconDisplay type={iconType} value={iconValue} size={16} />
            ) : null}
          </span>
          <span className="truncate font-mono text-sm">{name}</span>
        </div>
        <TileFrame label="Next letter">
          {creatingLetter ? (
            <CreatingPill />
          ) : (
            <Select
              value={action.next_letter_variant ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new_letter") {
                  startCreateLetter(async () => {
                    const { variant } = await createLetterInNextGroup(groupId);
                    onChange({ next_letter_variant: variant });
                  });
                  return;
                }
                if (v === "__new_group_and_letter") {
                  startCreateLetter(async () => {
                    const { variant } = await createNextLetterGroupAndLetter(
                      groupId
                    );
                    onChange({ next_letter_variant: variant });
                  });
                  return;
                }
                onChange({ next_letter_variant: v || null });
              }}
              className={cn("h-7 w-28 px-1", GHOST_FIELD)}
            >
              <option value="">—</option>
              {nextGroup
                ? nextGroupLetters.map((l) => (
                    <option
                      key={l.id}
                      value={l.variant ?? ""}
                      disabled={!l.variant}
                    >
                      {l.content_id}
                      {l.summary ? ` — ${l.summary.slice(0, 20)}` : ""}
                    </option>
                  ))
                : null}
              {nextGroup ? (
                <option value="__new_letter">+ Letter</option>
              ) : (
                <option value="__new_group_and_letter">
                  + Letter Group + Letter
                </option>
              )}
            </Select>
          )}
        </TileFrame>
        <TileFrame label="Report">
          {creatingSegment ? (
            <CreatingPill />
          ) : (
            <Select
              value={action.report_segment_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new_segment") {
                  startCreateSegment(async () => {
                    const { segmentId } = await createReportSegmentForGroup(
                      groupId,
                      nextDay?.id ?? null
                    );
                    onChange({ report_segment_id: segmentId });
                  });
                  return;
                }
                if (v === "__new_day_and_segment") {
                  if (!currentDay) return;
                  startCreateSegment(async () => {
                    const { segmentId } = await createNextDayAndReportSegment(
                      groupId,
                      currentDay.number
                    );
                    onChange({ report_segment_id: segmentId });
                  });
                  return;
                }
                onChange({ report_segment_id: v || null });
              }}
              className={cn("h-7 w-28 px-1", GHOST_FIELD)}
            >
              <option value="">—</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.report_id}
                </option>
              ))}
              {currentDay && !nextDay ? (
                <option value="__new_day_and_segment">
                  + Day + Report Segment
                </option>
              ) : (
                <option value="__new_segment">+ Report Segment</option>
              )}
            </Select>
          )}
        </TileFrame>
        <button
          type="button"
          onClick={onOpenSegment}
          disabled={!action.report_segment_id}
          aria-label="Open report segment"
          title={
            action.report_segment_id
              ? "Open report segment"
              : "No report segment assigned"
          }
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            segmentOpen
              ? "border-foreground/40 bg-accent/60 text-foreground"
              : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"
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
      </div>

      {/* Bottom row: Class Affinity | National Affinity | World */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-md bg-muted/30 p-2">
        <div className="flex flex-col gap-1">
          <AffinityGroupLabel>Class Affinity</AffinityGroupLabel>
          <div className="flex items-start gap-2">
            {CLASS_AFFINITY.map((c) => (
              <ClassTile
                key={c.key}
                label={c.label}
                value={action[c.key]}
                onChange={(v) =>
                  onChange({ [c.key]: v } as Partial<ActionState>)
                }
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 border-l border-border pl-4">
          <AffinityGroupLabel>National Affinity</AffinityGroupLabel>
          <div className="flex items-start gap-2">
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
        </div>

        {/* World: demerits on left, status on right — wraps as a unit */}
        <div className="flex flex-col gap-1 border-l border-border pl-4">
          <AffinityGroupLabel>World</AffinityGroupLabel>
          <div className="flex items-start gap-2">
            <ClassTile
              label="Demerits"
              value={action.impact_demerits}
              onChange={(v) =>
                onChange({ impact_demerits: v } as Partial<ActionState>)
              }
            />
            <ClassTile
              label="Status"
              value={action.impact_world_status}
              onChange={(v) =>
                onChange({ impact_world_status: v } as Partial<ActionState>)
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <DeleteButton onClick={onDelete} />
      </div>
    </div>
  );
}

function TileFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex h-6 items-center text-[10px] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function AffinityGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
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
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex h-6 items-center text-[10px] text-muted-foreground">
        {label}
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
  const fg = readableOnHex(nation.color_hex);
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="flex h-6 w-6 items-center justify-center rounded"
        style={{ background: nation.color_hex, color: fg }}
        title={nation.name}
      >
        {nation.icon_value ? (
          <IconDisplay
            type={nation.icon_type}
            value={nation.icon_value}
            size={12}
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

function GroupIdSwitcher({
  current,
  currentAbbr,
  siblings,
  onPick,
}: {
  current: Pick<LetterGroup, "id" | "sequence">;
  currentAbbr: string;
  siblings: Array<Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name">>;
  onPick: (slug: string) => void;
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
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch letter group"
        className="inline-flex items-center gap-1 rounded-md"
      >
        <Badge variant="secondary" className="font-mono">
          {currentAbbr}
          {current.sequence}
        </Badge>
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
          className="text-muted-foreground"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-md border border-border bg-card shadow-md"
        >
          {siblings.map((s) => {
            const active = s.id === current.id;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onPick(`${currentAbbr}${s.sequence}`);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/40",
                  active && "bg-accent/30"
                )}
              >
                <Badge variant="secondary" className="font-mono">
                  {currentAbbr}
                  {s.sequence}
                </Badge>
                <span className="truncate">{s.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
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
  onChange,
  className,
}: {
  value: string;
  days: Day[];
  groupDefaultId?: string | null;
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
  const displayText = selected
    ? `${selected.identifier}${selected.name ? ` — ${selected.name}` : ""}`
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
          <DayOption
            active={value === ""}
            onPick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            —
          </DayOption>
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
                  (Group Default)
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
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
    >
      <Trash2 size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

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

function StorylinesListPanel({
  storylines,
  groups,
  letters,
  days,
  selectedGroupId,
  onSelectGroup,
}: {
  storylines: Storyline[];
  groups: LetterGroup[];
  letters: InspectionLetterView[];
  days: Day[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
}) {
  const [openStorylineIds, setOpenStorylineIds] = useState<Set<string>>(
    () => new Set(storylines.map((s) => s.id))
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

  function toggle(id: string) {
    setOpenStorylineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {storylines.map((s) => {
        const bucket = groupsByStoryline.get(s.id) ?? [];
        const open = openStorylineIds.has(s.id);
        return (
          <div
            key={s.id}
            className="overflow-hidden rounded-md border border-border bg-card"
          >
            <button
              type="button"
              onClick={() => toggle(s.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30"
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ background: s.color_hex }}
              />
              <span className="flex-1 truncate text-sm font-semibold">
                {s.name}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {bucket.length}
              </span>
              <span
                aria-hidden
                className={cn(
                  "text-xs text-muted-foreground transition-transform",
                  open && "rotate-90"
                )}
              >
                ›
              </span>
            </button>
            {open ? (
              <div className="flex flex-col border-t border-border">
                {bucket.map((g) => {
                  const active = g.id === selectedGroupId;
                  const count = letterCountByGroup.get(g.id) ?? 0;
                  const day = g.delivery_day_id
                    ? dayById.get(g.delivery_day_id)
                    : null;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onSelectGroup(g.id)}
                      className={cn(
                        "flex items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm hover:bg-accent/30 first:border-t-0",
                        active && "bg-accent/40"
                      )}
                    >
                      <Badge variant="secondary" className="font-mono">
                        {s.abbreviation}
                        {g.sequence}
                      </Badge>
                      <span className="truncate">{g.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {count} letter{count === 1 ? "" : "s"}
                      </span>
                      {day ? (
                        <Badge variant="muted" className="ml-1 shrink-0">
                          {day.identifier}
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
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
  );
}
