"use client";

// Thin wrapper around _shared/document-editor.tsx for the Frameworks tab.
// Wires the framework-specific leaf component (TextBlock) and the preview
// view; everything else flows through the shared editor.

import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import { TextBlock } from "../_blocks/text-block";
import {
  DocumentEditor,
  type EditorHandle,
} from "../_shared/document-editor";
import { PreviewView } from "./preview-view";

export type { EditorHandle };

export function FrameworkEditor({
  framework,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  nations,
  onDeleted,
  registerHandle,
}: {
  framework: EndingDocument;
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  nations: Pick<Nation, "name" | "color_hex">[];
  onDeleted: () => void;
  registerHandle: (h: EditorHandle) => void;
}) {
  return (
    <DocumentEditor
      document={framework}
      blocks={blocks}
      rows={rows}
      chips={chips}
      blockVariables={blockVariables}
      variables={variables}
      values={values}
      nations={nations}
      leaves={{ text: TextBlock }}
      renderPreview={(args) => (
        <PreviewView
          name={args.name}
          blocks={args.blocks}
          rows={args.rows}
          chips={args.chips}
          variables={args.variables}
          referencedVariables={args.referencedVariables}
          values={args.values}
          selections={args.selections}
          onChangeText={args.onChangeText}
          onChangeNumber={args.onChangeNumber}
        />
      )}
      onDeleted={onDeleted}
      registerHandle={registerHandle}
    />
  );
}
