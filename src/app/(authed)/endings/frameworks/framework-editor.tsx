"use client";

// Thin wrapper around _shared/document-editor.tsx for the Frameworks tab.
// Wires the framework-specific leaf component (TextBlock) and the preview
// view; everything else flows through the shared editor.

import { useMemo } from "react";
import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableFolder,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import type { EndingLogicKind } from "@/lib/db/enums";
import {
  EMPTY_SELECTIONS,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
} from "@/lib/endings/evaluator";
import { TextBlock } from "../_blocks/text-block";
import { DocumentEditor } from "../_shared/document-editor";
import { PreviewView } from "./preview-view";

export function FrameworkEditor({
  framework,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  smartVariableReturns,
  smartVariableDocs,
  smartVariableAllBlocks,
  smartVariableRows,
  smartVariableChips,
  folders,
  nations,
  tiebreakDocsSummary,
  tiebreakDocsRaw,
  onDeleted,
}: {
  framework: EndingDocument;
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  smartVariableReturns?: Map<string, string[]>;
  smartVariableDocs?: EndingDocument[];
  smartVariableAllBlocks?: EndingBlock[];
  smartVariableRows?: EndingConditionRow[];
  smartVariableChips?: EndingConditionRowChip[];
  folders: EndingVariableFolder[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  tiebreakDocsSummary?: Map<EndingLogicKind, { isEmpty: boolean }>;
  tiebreakDocsRaw?: Map<
    EndingLogicKind,
    {
      blocks: EndingBlock[];
      rows: EndingConditionRow[];
      chips: EndingConditionRowChip[];
    }
  >;
  onDeleted: () => void;
}) {
  // Build per-logic-kind EvalInputs once for the preview. The preview
  // threads these into selections.tiebreak_docs so aggregate chips
  // resolve through the saved tiebreak rules, AND surfaces them
  // separately as tie indicators when the user's numeric inputs
  // trigger an aggregate tie.
  const tiebreakInputs = useMemo(() => {
    if (!tiebreakDocsRaw) return undefined;
    const evalVariables: EvalVariable[] = variables.map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.kind,
      aggregate_ref: (v.aggregate_ref ?? null) as EvalVariable["aggregate_ref"],
    }));
    const numberRefByName = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) {
        numberRefByName.set(v.number_ref, v.id);
      }
    }
    const m = new Map<EndingLogicKind, EvalInputs>();
    for (const [kind, raw] of tiebreakDocsRaw) {
      m.set(kind, {
        blocks: raw.blocks as unknown as EvalBlock[],
        rows: raw.rows as unknown as EvalRow[],
        chips: raw.chips as unknown as EvalChip[],
        variables: evalVariables,
        selections: { ...EMPTY_SELECTIONS, numberRefByName },
      });
    }
    return m;
  }, [tiebreakDocsRaw, variables]);

  return (
    <DocumentEditor
      document={framework}
      blocks={blocks}
      rows={rows}
      chips={chips}
      blockVariables={blockVariables}
      variables={variables}
      values={values}
      smartVariableReturns={smartVariableReturns}
      folders={folders}
      nations={nations}
      tiebreakDocsSummary={tiebreakDocsSummary}
      leaves={{ text: TextBlock }}
      renderPreview={(args) => (
        <PreviewView
          name={args.name}
          blocks={args.blocks}
          rows={args.rows}
          chips={args.chips}
          blockVariables={args.blockVariables}
          variables={args.variables}
          referencedVariables={args.referencedVariables}
          values={args.values}
          selections={args.selections}
          onChangeText={args.onChangeText}
          onChangeNumber={args.onChangeNumber}
          flashColors={args.flashColors}
          tiebreakInputs={tiebreakInputs}
          nations={nations}
          smartVariableDocs={smartVariableDocs ?? []}
          smartVariableAllBlocks={smartVariableAllBlocks ?? []}
          smartVariableRows={smartVariableRows ?? []}
          smartVariableChips={smartVariableChips ?? []}
        />
      )}
      onDeleted={onDeleted}
    />
  );
}
