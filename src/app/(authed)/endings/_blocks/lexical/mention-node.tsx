"use client";

// Custom Lexical node that renders an `@[Variable Name]` token as a
// colored inline pill. Atomic (caret can't enter), inline (sits inline
// with surrounding text). Serializes to plain text as `@[Name]` so the
// DB shape stays compatible with Phase 1's evaluator.

import {
  $applyNodeReplacement,
  $getNodeByKey,
  $isTextNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { createContext, useContext, type JSX } from "react";
import type { VariableState } from "@/lib/endings/block-state";
import { paletteColor } from "@/lib/endings/color-palette";
import { cn } from "@/lib/utils";

export type SerializedMentionNode = Spread<
  { variableName: string },
  SerializedLexicalNode
>;

export class MentionNode extends DecoratorNode<JSX.Element> {
  __variableName: string;

  static getType(): string {
    return "ending-mention";
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__variableName, node.__key);
  }

  constructor(variableName: string, key?: NodeKey) {
    super(key);
    this.__variableName = variableName;
  }

  getVariableName(): string {
    return this.__variableName;
  }

  // --- Serialization -------------------------------------------------

  static importJSON(serialized: SerializedMentionNode): MentionNode {
    return $createMentionNode(serialized.variableName);
  }

  exportJSON(): SerializedMentionNode {
    return {
      type: MentionNode.getType(),
      version: 1,
      variableName: this.__variableName,
    };
  }

  /** Plain-text representation, used by Lexical's text/plain clipboard
   *  serializer and by our custom `lexicalRootToText` walker. */
  getTextContent(): string {
    return `@[${this.__variableName}]`;
  }

  // --- Inline + atomic behavior --------------------------------------

  isInline(): boolean {
    return true;
  }

  /** Atomic. Caret never enters the pill; arrow keys hop over it. */
  isKeyboardSelectable(): boolean {
    return true;
  }

  // --- DOM render -----------------------------------------------------

  createDOM(_config: EditorConfig): HTMLElement {
    // Lexical owns this outer wrapper; React mounts the decorated view
    // inside it via createPortal. Use an inline element so the
    // selection/caret logic treats the pill as a single atom.
    const span = document.createElement("span");
    span.setAttribute("data-lexical-decorator", "true");
    span.setAttribute("data-mention", this.__variableName);
    return span;
  }

  updateDOM(): boolean {
    // The portal re-renders on its own; Lexical doesn't need to swap
    // the outer DOM when the node updates.
    return false;
  }

  decorate(): JSX.Element {
    return (
      <MentionPillView
        nodeKey={this.__key}
        variableName={this.__variableName}
      />
    );
  }
}

// ---------------------------------------------------------------------
// Variable lookup via React Context
// ---------------------------------------------------------------------
//
// Lexical decorations mount via createPortal, which keeps React context
// flowing from the editor's tree. So a plain Context works — no global
// registry needed. The editor wraps its <LexicalComposer> tree with
// <MentionVariablesContext.Provider value={variables}>.

const MentionVariablesContext = createContext<VariableState[]>([]);

export function MentionVariablesProvider({
  variables,
  children,
}: {
  variables: VariableState[];
  children: React.ReactNode;
}) {
  return (
    <MentionVariablesContext.Provider value={variables}>
      {children}
    </MentionVariablesContext.Provider>
  );
}

interface MentionPillViewProps {
  nodeKey: NodeKey;
  variableName: string;
}

function MentionPillView({ nodeKey, variableName }: MentionPillViewProps) {
  const variables = useContext(MentionVariablesContext);
  const [editor] = useLexicalComposerContext();
  const variable =
    variables.find((v) => v.name === variableName) ?? null;

  // Click on the pill places the caret immediately after the node so
  // typing continues outside it. Without this, click events on the
  // contentEditable=false pill produce no Lexical selection update.
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!node) return;
      const next = node.getNextSibling();
      if (next && $isTextNode(next)) {
        next.select(0, 0);
      } else {
        node.selectNext();
      }
    });
  };

  if (!variable) {
    return (
      <span
        className={cn(
          "inline-flex h-5 cursor-pointer items-center rounded-md border border-amber-500/50 bg-transparent px-1.5 align-baseline text-[10px] font-mono font-semibold uppercase leading-[16px] tracking-[0.025em] text-amber-200 select-none"
        )}
        title={`Unknown variable: ${variableName}`}
        contentEditable={false}
        onClick={handleClick}
      >
        @[{variableName}]
      </span>
    );
  }
  const color = variable.color_hex ?? paletteColor(variable.color_index);
  return (
    <span
      className={cn(
        "inline-flex h-5 cursor-pointer items-center rounded-md px-1.5 align-baseline text-[10px] font-mono font-semibold uppercase leading-[16px] tracking-[0.025em] select-none"
      )}
      style={{ backgroundColor: color, color: "var(--block-card)" }}
      contentEditable={false}
      onClick={handleClick}
    >
      {variableName}
    </span>
  );
}

// ---------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------

export function $createMentionNode(variableName: string): MentionNode {
  return $applyNodeReplacement(new MentionNode(variableName));
}

export function $isMentionNode(
  node: LexicalNode | null | undefined
): node is MentionNode {
  return node instanceof MentionNode;
}
