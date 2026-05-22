"use server";

// Scope-aware folder primitives shared by /endings/variables and
// /endings/smart-variables. The two pages own their own `revalidatePath`
// fan-out — these helpers only mutate the DB and don't call
// revalidatePath themselves.
//
// Scope split:
//   - regular variables (kind='text') live in 'variable'-scope folders
//   - smart variables (kind='smart_ref') live in 'smart_variable'-scope folders
// DB triggers reject cross-scope assignment, so these helpers stay
// scope-pure as long as the caller passes a consistent (scope,
// variableKind) pair.

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slug";

export type FolderScope = "variable" | "smart_variable";
export type FolderVariableKind = "text" | "smart_ref";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Find a non-colliding folder name within the given scope by appending
 * " 2" / " 3" / … until the slug is unique. Slug-aware so two visually
 * distinct names ("Foo!" / "Foo?") that slugify the same get bumped
 * too. Also cross-checks the variables of the corresponding kind
 * (text for `variable` scope, smart_ref for `smart_variable` scope) so
 * the shared `?name=<slug>` URL space stays unambiguous. Excludes
 * `excludeFolderId` (the row being renamed) so a no-op rename doesn't
 * get bumped.
 */
async function uniqueScopedFolderName(
  supabase: Supabase,
  scope: FolderScope,
  base: string,
  excludeFolderId?: string
): Promise<string> {
  const variableKind: FolderVariableKind =
    scope === "smart_variable" ? "smart_ref" : "text";
  const [{ data: folders }, { data: vars }] = await Promise.all([
    supabase
      .from("ending_variable_folders")
      .select("id, name")
      .eq("scope", scope),
    supabase
      .from("ending_variables")
      .select("id, name")
      .eq("kind", variableKind),
  ]);
  const folderRows = folders ?? [];
  const varRows = vars ?? [];
  let name = base;
  for (let i = 2; ; i++) {
    const slug = slugify(name);
    const conflict =
      folderRows.some(
        (f) => f.id !== excludeFolderId && slugify(f.name as string) === slug
      ) || varRows.some((v) => slugify(v.name as string) === slug);
    if (!conflict) return name;
    name = `${base} ${i}`;
  }
}

/** Insert a new folder at the bottom of its sibling group (scope-aware). */
export async function createScopedFolder(input: {
  scope: FolderScope;
  parentFolderId: string | null;
  id?: string;
  name?: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const parent = input.parentFolderId ?? null;

  let siblingsQuery = supabase
    .from("ending_variable_folders")
    .select("sort_order")
    .eq("scope", input.scope)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (parent === null) {
    siblingsQuery = siblingsQuery.is("parent_folder_id", null);
  } else {
    siblingsQuery = siblingsQuery.eq("parent_folder_id", parent);
  }
  const { data: existing } = await siblingsQuery;
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;

  const id = input.id ?? randomUUID();
  // Auto-disambiguate via slugify so two distinct names that slugify
  // the same collide too. Also cross-checks the variables namespace
  // (text for variable scope, smart_ref for smart_variable scope) so
  // ?name=<slug> resolves unambiguously per page.
  const folderName = await uniqueScopedFolderName(
    supabase,
    input.scope,
    input.name?.trim() || "New folder"
  );
  const { error } = await supabase.from("ending_variable_folders").insert({
    id,
    name: folderName,
    parent_folder_id: parent,
    sort_order: nextSort,
    scope: input.scope,
  });
  if (error) throw new Error(error.message);
  return { id };
}

/** Narrow per-field patch — used by inline rename + the inspector's
 *  parent-picker. Scope is immutable post-create; trying to PATCH `scope`
 *  is silently dropped. */
export async function patchScopedFolder(input: {
  scope: FolderScope;
  id: string;
  patch: Partial<{
    name: string;
    parent_folder_id: string | null;
    sort_order: number;
  }>;
}): Promise<{ savedName?: string; collided?: boolean }> {
  const supabase = await createSupabaseServerClient();
  const sanitized: typeof input.patch = { ...input.patch };

  let collided = false;
  let savedName: string | undefined;
  if (sanitized.name !== undefined) {
    const trimmed = sanitized.name.trim();
    if (!trimmed) throw new Error("Folder name cannot be empty.");
    // Auto-disambiguate slug collisions (folders + variables share the
    // ?name=<slug> namespace per scope) by appending " 2" / " 3" / …
    const finalName = await uniqueScopedFolderName(
      supabase,
      input.scope,
      trimmed,
      input.id
    );
    collided = finalName !== trimmed;
    savedName = finalName;
    sanitized.name = finalName;
  }
  if (sanitized.parent_folder_id === input.id) {
    throw new Error("A folder cannot be its own parent.");
  }

  // Scope predicate prevents a smart-variable caller from accidentally
  // patching a 'variable'-scope folder (or vice versa). The UPDATE
  // simply matches zero rows on a mismatch and we surface a clear
  // error instead of silently re-scoping a folder out from under its
  // page.
  const { data, error } = await supabase
    .from("ending_variable_folders")
    .update(sanitized)
    .eq("id", input.id)
    .eq("scope", input.scope)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      `patchScopedFolder: no ${input.scope}-scope folder with id ${input.id}.`
    );
  }
  return { savedName, collided };
}

/** Move a variable into `folder_id` at the position before `before_id`
 *  (null = end of group). `variableKind` decides which siblings share
 *  the destination's sort space — pass 'text' for regular vars and
 *  'smart_ref' for smart vars. */
export async function moveScopedVariable(input: {
  variableKind: FolderVariableKind;
  variableId: string;
  folderId: string | null;
  beforeId: string | null;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { variableKind, variableId, folderId, beforeId } = input;
  if (!variableId) throw new Error("variableId is required.");
  if (beforeId === variableId) {
    throw new Error("A row cannot be placed before itself.");
  }

  // Constrain by `kind` so a wrong-kind id (e.g. a 'text' variable
  // passed through the smart-variable path) fails loudly rather than
  // silently moving the row + leaving its true sibling group's
  // sort_order untouched.
  const { data: moved, error: moveErr } = await supabase
    .from("ending_variables")
    .update({ folder_id: folderId })
    .eq("id", variableId)
    .eq("kind", variableKind)
    .select("id");
  if (moveErr) throw new Error(moveErr.message);
  if (!moved || moved.length === 0) {
    throw new Error(
      `moveScopedVariable: no ${variableKind} variable with id ${variableId}.`
    );
  }

  let q = supabase
    .from("ending_variables")
    .select("id, sort_order")
    .eq("kind", variableKind)
    .order("sort_order", { ascending: true });
  if (folderId === null) q = q.is("folder_id", null);
  else q = q.eq("folder_id", folderId);
  const { data: siblings, error: readErr } = await q;
  if (readErr) throw new Error(readErr.message);

  const ordered = (siblings ?? []).map((s) => s.id);
  const without = ordered.filter((id) => id !== variableId);
  let insertAt = beforeId ? without.indexOf(beforeId) : -1;
  if (insertAt < 0) insertAt = without.length;
  const next = [...without];
  next.splice(insertAt, 0, variableId);

  await renumberSortOrders(supabase, "ending_variables", next);
}

/** Move a folder under `parent_folder_id` (null = root) at the position
 *  before `before_id`. Server walks the ancestor chain for a friendly
 *  cycle toast; the DB trigger evf_no_cycle is the authoritative wall. */
export async function moveScopedFolder(input: {
  scope: FolderScope;
  folderId: string;
  parentFolderId: string | null;
  beforeId: string | null;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { scope, folderId, parentFolderId, beforeId } = input;
  if (!folderId) throw new Error("folderId is required.");
  if (beforeId === folderId) {
    throw new Error("A row cannot be placed before itself.");
  }
  if (parentFolderId === folderId) {
    throw new Error("A folder cannot be its own parent.");
  }

  if (parentFolderId !== null) {
    let cursor: string | null = parentFolderId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === folderId) {
        throw new Error("Can't move a folder into itself or a descendant.");
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parentRow: { parent_folder_id: string | null } | null = (
        await supabase
          .from("ending_variable_folders")
          .select("parent_folder_id")
          .eq("id", cursor)
          .maybeSingle()
      ).data;
      if (!parentRow) break;
      cursor = parentRow.parent_folder_id ?? null;
    }
  }

  // Scope predicate: a `smart_variable` caller can't move (or no-op
  // touch) a `variable`-scope folder via this helper.
  const { data: moved, error: moveErr } = await supabase
    .from("ending_variable_folders")
    .update({ parent_folder_id: parentFolderId })
    .eq("id", folderId)
    .eq("scope", scope)
    .select("id");
  if (moveErr) throw new Error(moveErr.message);
  if (!moved || moved.length === 0) {
    throw new Error(
      `moveScopedFolder: no ${scope}-scope folder with id ${folderId}.`
    );
  }

  let q = supabase
    .from("ending_variable_folders")
    .select("id, sort_order")
    .eq("scope", scope)
    .order("sort_order", { ascending: true });
  if (parentFolderId === null) q = q.is("parent_folder_id", null);
  else q = q.eq("parent_folder_id", parentFolderId);
  const { data: siblings, error: readErr } = await q;
  if (readErr) throw new Error(readErr.message);

  const ordered = (siblings ?? []).map((s) => s.id);
  const without = ordered.filter((id) => id !== folderId);
  let insertAt = beforeId ? without.indexOf(beforeId) : -1;
  if (insertAt < 0) insertAt = without.length;
  const next = [...without];
  next.splice(insertAt, 0, folderId);

  await renumberSortOrders(supabase, "ending_variable_folders", next);
}

/** Delete a folder, reparenting child folders + contained variables to
 *  the folder's own parent (null = root) first. Non-destructive — the
 *  DB FK on parent_folder_id is `on delete restrict`, so the reparent
 *  must happen before the final delete. */
export async function deleteScopedFolder(input: {
  scope: FolderScope;
  id: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { scope, id } = input;
  if (!id) return;

  // Read the folder and confirm its scope matches the caller. A
  // wrong-scope id is rejected loudly — the older silent-no-op
  // behaviour would have masked routing bugs and (worse) let a
  // smart-variable caller delete a regular folder by id collision.
  const { data: folder } = await supabase
    .from("ending_variable_folders")
    .select("parent_folder_id, scope")
    .eq("id", id)
    .maybeSingle();
  if (!folder) return;
  if (folder.scope !== scope) {
    throw new Error(
      `deleteScopedFolder: folder ${id} is ${folder.scope}-scope; caller expected ${scope}.`
    );
  }
  const newParent = folder.parent_folder_id ?? null;

  const { error: reparentFoldersErr } = await supabase
    .from("ending_variable_folders")
    .update({ parent_folder_id: newParent })
    .eq("parent_folder_id", id);
  if (reparentFoldersErr) throw new Error(reparentFoldersErr.message);

  const { error: reparentVarsErr } = await supabase
    .from("ending_variables")
    .update({ folder_id: newParent })
    .eq("folder_id", id);
  if (reparentVarsErr) throw new Error(reparentVarsErr.message);

  const { error: delErr } = await supabase
    .from("ending_variable_folders")
    .delete()
    .eq("id", id);
  if (delErr) throw new Error(delErr.message);
}

/** Renumber sort_order for the given ordered ids so they read 1..N.
 *  Skips rows whose sort_order is already correct to keep the write set
 *  minimal (most reorders only shuffle one row). */
async function renumberSortOrders(
  supabase: Supabase,
  table: "ending_variables" | "ending_variable_folders",
  orderedIds: string[]
): Promise<void> {
  const { data: current } = await supabase
    .from(table)
    .select("id, sort_order")
    .in("id", orderedIds);
  const currentMap = new Map(
    (current ?? []).map((r) => [r.id as string, r.sort_order as number])
  );
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const next = i + 1;
    if (currentMap.get(id) === next) continue;
    const { error } = await supabase
      .from(table)
      .update({ sort_order: next })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
}
