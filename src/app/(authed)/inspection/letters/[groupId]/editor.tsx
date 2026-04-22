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
  createInspectionLettersInGroup,
  createLetterInNextGroup,
  createNextLetterGroupAndLetter,
  createReportSegmentForGroup,
  deleteActionRow,
  deleteGroup,
  deleteInspectionLetter,
  quickCreateCitizen,
  reorderInspectionLetters,
  saveGroup,
  saveLetterWithActions,
} from "./actions";
import { useSearchParams } from "next/navigation";

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

export function GroupEditor({
  group,
  storylines,
  days,
  letters,
  actions,
  templates,
  heroes: initialHeroes,
  cities,
  nations,
  segments,
  nextGroup,
  nextGroupLetters,
}: {
  group: LetterGroup;
  storylines: Storyline[];
  days: Day[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  segments: ReportSegmentView[];
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
}) {
  const storylineById = useMemo(
    () => new Map(storylines.map((s) => [s.id, s])),
    [storylines]
  );

  // ----- Group state -----
  const [groupState, setGroupState] = useState({
    storyline_id: group.storyline_id,
    name: group.name,
    delivery_day_id: group.delivery_day_id,
    notes: group.notes,
  });
  const [groupDirty, setGroupDirty] = useState(false);
  const [groupPending, startGroupSave] = useTransition();

  useEffect(() => {
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
  const searchParams = useSearchParams();
  const skipInitial = searchParams.get("letter") === "none";
  const [selectedId, setSelectedId] = useState<string | null>(
    skipInitial ? null : letters[0]?.id ?? null
  );
  const [letterState, setLetterState] = useState<LetterState | null>(() => {
    if (skipInitial || !letters[0]) return null;
    return toLetterState(letters[0], actions);
  });
  const [listLocked, setListLocked] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [letterDirty, setLetterDirty] = useState(false);
  const [letterPending, startLetterSave] = useTransition();
  const [rowPending, startRowAction] = useTransition();

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
    if (id === selectedId) return;
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
    let alsoSaveLetter = false;
    if (letterDirty && letterState) {
      alsoSaveLetter = confirm(
        "The open letter has unsaved changes. Save the letter too?"
      );
    }
    const snapshot = letterState;
    startGroupSave(async () => {
      await saveGroup({
        id: group.id,
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
    if (letterDirty) {
      const ok = confirm(
        "The open letter has unsaved changes. Discard them and add?"
      );
      if (!ok) return;
    }
    startRowAction(async () => {
      const ids = await createInspectionLettersInGroup(group.id, count);
      if (ids[0]) setSelectedId(ids[0]);
      setLetterDirty(false);
    });
  }

  function handleDeleteLetter(id: string) {
    const l = letters.find((x) => x.id === id);
    if (!l) return;
    if (!confirm(`Delete letter ${l.content_id}? This cannot be undone.`))
      return;
    startRowAction(async () => {
      await deleteInspectionLetter(group.id, id);
      if (selectedId === id) {
        setSelectedId(null);
        setLetterState(null);
        setLetterDirty(false);
      }
    });
  }

  function handleDeleteGroup() {
    if (
      !confirm(
        `Delete letter group "${group.name}" and all of its letters? This cannot be undone.`
      )
    )
      return;
    startGroupSave(async () => {
      await deleteGroup(group.id);
    });
  }

  function handleAddAction(templateId: string) {
    if (!selectedId || !templateId) return;
    if (letterDirty) {
      const ok = confirm(
        "This letter has unsaved changes. Save them before adding an action? (Cancel to discard.)"
      );
      if (ok && letterState) {
        const snap = letterState;
        startRowAction(async () => {
          await saveLetterNow(snap);
          await addActionFromTemplate(group.id, selectedId, templateId);
          setLetterDirty(false);
        });
        return;
      }
    }
    startRowAction(async () => {
      await addActionFromTemplate(group.id, selectedId!, templateId);
      setLetterDirty(false);
    });
  }

  function handleDeleteAction(actionId: string) {
    if (!confirm("Delete this action? This cannot be undone.")) return;
    startRowAction(async () => {
      await deleteActionRow(group.id, actionId);
    });
  }

  async function handleQuickCreateHero(role: "sender" | "receiver") {
    const name = prompt("New hero name");
    if (!name || !name.trim()) return;
    const row = await quickCreateCitizen({ name, type: "hero" });
    const created: Citizen = {
      id: row.id,
      name: row.name,
      type: row.type,
      citizen_id: null,
      nation_id: null,
      city_id: null,
      notes: null,
    };
    setHeroes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    if (role === "sender") updateLetter({ sender_citizen_id: created.id });
    else updateLetter({ receiver_citizen_id: created.id });
  }

  const currentStoryline = storylineById.get(groupState.storyline_id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {currentStoryline?.abbreviation ?? "?"}
              {group.sequence}
            </Badge>
            {groupState.name || (
              <span className="text-muted-foreground italic">(unnamed)</span>
            )}
          </span>
        }
        actions={
          <Button
            type="button"
            onClick={handleSaveGroup}
            disabled={groupPending || !groupDirty}
            variant={groupDirty ? "default" : "secondary"}
            size="sm"
          >
            {groupPending ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              "Save group"
            )}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-6">
        {/* LEFT: group info + letter list */}
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Group
            </h3>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3 flex flex-col gap-1">
                <Label>Storyline</Label>
                <Select
                  value={groupState.storyline_id}
                  onChange={(e) => updateGroup("storyline_id", e.target.value)}
                  className="h-8"
                >
                  {storylines.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-3 flex flex-col gap-1">
                <Label>Name</Label>
                <Input
                  value={groupState.name}
                  onChange={(e) => updateGroup("name", e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="col-span-3 flex flex-col gap-1">
                <Label>Delivery day</Label>
                <Select
                  value={groupState.delivery_day_id ?? ""}
                  onChange={(e) =>
                    updateGroup("delivery_day_id", e.target.value || null)
                  }
                  className="h-8"
                >
                  <option value="">—</option>
                  {days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.identifier}
                      {d.name ? ` — ${d.name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-6 flex flex-col gap-1">
                <Label>Notes</Label>
                <Textarea
                  value={groupState.notes ?? ""}
                  onChange={(e) => updateGroup("notes", e.target.value || null)}
                  rows={2}
                />
              </div>
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
                      active && "bg-accent/40",
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
                    {listLocked ? (
                      <DeleteX
                        label={`Delete letter ${l.content_id}`}
                        onClick={() => handleDeleteLetter(l.id)}
                      />
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
        </div>

        {/* RIGHT: selected letter detail */}
        <div className="flex flex-col gap-4">
          {letterState ? (
            <LetterDetail
              key={letterState.id}
              state={letterState}
              letterView={letters.find((l) => l.id === letterState.id)!}
              groupDeliveryDayId={groupState.delivery_day_id}
              days={days}
              heroes={heroes}
              cities={cities}
              nations={nations}
              templates={templates}
              segments={segments}
              nextGroup={nextGroup}
              nextGroupLetters={nextGroupLetters}
              groupId={group.id}
              dirty={letterDirty}
              pending={letterPending}
              rowPending={rowPending}
              onChange={updateLetter}
              onActionChange={updateAction}
              onAddAction={handleAddAction}
              onDeleteAction={handleDeleteAction}
              onQuickCreateHero={handleQuickCreateHero}
              onSave={handleSaveLetter}
            />
          ) : (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Select a letter to edit, or add one.
            </div>
          )}
        </div>
      </div>

      {/* Delete group at bottom */}
      <div className="mt-8 flex justify-center border-t border-border pt-6">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleDeleteGroup}
          disabled={groupPending}
        >
          Delete group
        </Button>
      </div>
    </div>
  );
}

function LetterDetail({
  state,
  letterView,
  groupDeliveryDayId,
  days,
  heroes,
  cities,
  nations,
  templates,
  segments,
  nextGroup,
  nextGroupLetters,
  groupId,
  dirty,
  pending,
  rowPending,
  onChange,
  onActionChange,
  onAddAction,
  onDeleteAction,
  onQuickCreateHero,
  onSave,
}: {
  state: LetterState;
  letterView: InspectionLetterView;
  groupDeliveryDayId: string | null;
  days: Day[];
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  templates: ActionTemplate[];
  segments: ReportSegmentView[];
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
  groupId: string;
  dirty: boolean;
  pending: boolean;
  rowPending: boolean;
  onChange: (patch: Partial<LetterState>) => void;
  onActionChange: (idx: number, patch: Partial<ActionState>) => void;
  onAddAction: (templateId: string) => void;
  onDeleteAction: (actionId: string) => void;
  onQuickCreateHero: (role: "sender" | "receiver") => void;
  onSave: () => void;
}) {

  // The "Delivery Day" dropdown: value is the override; falls back to group day implicitly.
  const currentDayId = state.delivery_day_override_id ?? groupDeliveryDayId;
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Badge variant="secondary">{letterView.content_id}</Badge>
            {dirty ? (
              <span className="text-warning">• unsaved</span>
            ) : (
              <span className="text-muted-foreground/70">saved</span>
            )}
          </h3>
          <Button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty}
            variant={dirty ? "default" : "secondary"}
            size="sm"
          >
            {pending ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              "Save letter"
            )}
          </Button>
        </div>
        <div className="grid grid-cols-6 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Piece</Label>
            <Input
              type="number"
              value={state.piece ?? ""}
              onChange={(e) =>
                onChange({
                  piece: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="h-8"
            />
          </div>
          <div className="col-span-5 flex flex-col gap-1">
            <Label>Delivery day</Label>
            <Select
              value={currentDayId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                // Storing null when matches the group default keeps "inherit"
                // semantics; otherwise store an explicit override.
                onChange({
                  delivery_day_override_id:
                    v === "" ? null : v === groupDeliveryDayId ? null : v,
                });
              }}
              className="h-8"
            >
              <option value="">—</option>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.identifier}
                  {d.name ? ` — ${d.name}` : ""}
                  {d.id === groupDeliveryDayId ? " (Group Default)" : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Summary</Label>
            <Input
              value={state.summary ?? ""}
              onChange={(e) => onChange({ summary: e.target.value || null })}
              className="h-8"
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
            />
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Content (markdown)</Label>
            <AutoTextarea
              value={state.content ?? ""}
              onChange={(e) => onChange({ content: e.target.value || null })}
              minRows={6}
              className="font-mono text-xs"
            />
          </div>
          <div className="col-span-6 flex flex-col gap-1">
            <Label>Notes</Label>
            <AutoTextarea
              value={state.notes ?? ""}
              onChange={(e) => onChange({ notes: e.target.value || null })}
              minRows={2}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Actions ({state.actions.length})
          </h4>
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
              className="h-7 w-auto"
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
              aria-label="Add action"
              title="Add action"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {state.actions.map((a, i) => (
            <ActionEditor
              key={a.id}
              action={a}
              templates={templates}
              nations={nations}
              segments={segments}
              nextGroup={nextGroup}
              nextGroupLetters={nextGroupLetters}
              groupId={groupId}
              onChange={(patch) => onActionChange(i, patch)}
              onDelete={() => onDeleteAction(a.id)}
            />
          ))}
          {state.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatAddress(
  hero: Citizen,
  cities: City[],
  nations: Nation[]
): string {
  const parts: string[] = [];
  if (hero.citizen_id) parts.push(hero.citizen_id);
  const city = hero.city_id ? cities.find((c) => c.id === hero.city_id) : null;
  if (city) parts.push(city.name);
  const nation = hero.nation_id
    ? nations.find((n) => n.id === hero.nation_id)
    : null;
  if (nation) parts.push(nation.name);
  return parts.join(" · ");
}

function HeroSearch({
  value,
  heroes,
  cities,
  nations,
  onChange,
  onCreate,
}: {
  value: string | null;
  heroes: Citizen[];
  cities: City[];
  nations: Nation[];
  onChange: (v: string | null) => void;
  onCreate: () => void;
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
    const address = formatAddress(selected, cities, nations);
    return (
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-0.5 rounded-full border border-border bg-muted/40 px-3 py-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-sm">{selected.name}</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Clear selection"
              title="Clear"
              className="text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </div>
          {address ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {address}
            </span>
          ) : null}
        </div>
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
          className="h-8 flex-1"
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
            const address = formatAddress(h, cities, nations);
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
                {address ? (
                  <span className="text-[10px] text-muted-foreground">
                    {address}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
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
  onChange,
  onDelete,
}: {
  action: ActionState;
  templates: ActionTemplate[];
  nations: Nation[];
  segments: ReportSegmentView[];
  nextGroup: Pick<LetterGroup, "id" | "storyline_id" | "sequence" | "name"> | null;
  nextGroupLetters: InspectionLetterView[];
  groupId: string;
  onChange: (patch: Partial<ActionState>) => void;
  onDelete: () => void;
}) {
  const [, startCreate] = useTransition();
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
      {/* Top row: icon, name, delete */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
          style={{ background: colorHex, color: "#fff" }}
        >
          {iconValue ? (
            <IconDisplay type={iconType} value={iconValue} size={16} />
          ) : null}
        </span>
        <span className="flex-1 font-mono text-sm">{name}</span>
        <DeleteX label="Delete action" onClick={onDelete} />
      </div>

      {/* Affinity line: Next letter + Report segment | Class | National | Player */}
      <div className="flex items-start gap-4 rounded-md bg-muted/30 p-2">
        <div className="flex items-start gap-2 pt-[1.375rem]">
          <TileFrame label="Next letter">
            <Select
              value={action.next_letter_variant ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new_letter") {
                  startCreate(async () => {
                    await createLetterInNextGroup(groupId);
                  });
                  return;
                }
                if (v === "__new_group_and_letter") {
                  startCreate(async () => {
                    await createNextLetterGroupAndLetter(groupId);
                  });
                  return;
                }
                onChange({ next_letter_variant: v || null });
              }}
              className="h-7 w-28 px-1"
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
                <option value="__new_letter">+ New letter</option>
              ) : (
                <option value="__new_group_and_letter">
                  + Group + Letter
                </option>
              )}
            </Select>
          </TileFrame>
          <TileFrame label="Report">
            <Select
              value={action.report_segment_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new_segment") {
                  startCreate(async () => {
                    await createReportSegmentForGroup(groupId);
                  });
                  return;
                }
                onChange({ report_segment_id: v || null });
              }}
              className="h-7 w-28 px-1"
            >
              <option value="">—</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.report_id}
                </option>
              ))}
              <option value="__new_segment">+ New segment</option>
            </Select>
          </TileFrame>
        </div>

        <div className="flex flex-col gap-1 border-l border-border pl-4">
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

        <div className="flex flex-col gap-1 border-l border-border pl-4">
          <AffinityGroupLabel>Player</AffinityGroupLabel>
          <div className="flex items-start gap-2">
            <ClassTile
              label="Status"
              value={action.impact_world_status}
              onChange={(v) =>
                onChange({ impact_world_status: v } as Partial<ActionState>)
              }
            />
            <ClassTile
              label="Demerits"
              value={action.impact_demerits}
              onChange={(v) =>
                onChange({ impact_demerits: v } as Partial<ActionState>)
              }
            />
          </div>
        </div>
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
  orientation,
}: {
  value: number;
  onChange: (v: number) => void;
  orientation: "horizontal" | "vertical";
}) {
  const input = (
    <Input
      type="text"
      inputMode="numeric"
      value={value === 0 ? "" : String(value)}
      placeholder=""
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9-]/g, "");
        if (raw === "" || raw === "-") {
          onChange(0);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="h-7 w-8 px-1 text-center"
    />
  );
  const minus = (
    <button
      type="button"
      onClick={() => onChange(value - 1)}
      tabIndex={-1}
      className="flex h-4 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Decrease"
    >
      −
    </button>
  );
  const plus = (
    <button
      type="button"
      onClick={() => onChange(value + 1)}
      tabIndex={-1}
      className="flex h-4 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Increase"
    >
      +
    </button>
  );
  if (orientation === "vertical") {
    return (
      <div className="flex flex-col items-center gap-0.5">
        {plus}
        {input}
        {minus}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {minus}
      {input}
      {plus}
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
