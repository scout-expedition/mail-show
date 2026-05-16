// @vitest-environment jsdom

// Interaction tests for the Lexical-based RichTextEditor. Uses React Testing
// Library + jsdom to verify the value/onChange contract that the surrounding
// inspection-letter / report-segment forms depend on: flash-free initial
// hydration, no spurious mount-time onChange, typing emits a JSON string,
// emptying emits "", and a changed `value` prop re-syncs via ValueSyncPlugin.
//
// Toolbar/keyboard formatting is deliberately not exercised here — those paths
// depend on real selection geometry that jsdom does not provide reliably. The
// serialize module (which the toolbar's commands ultimately feed) is covered
// in serialize.test.ts.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  $getRoot,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
} from "lexical";
import { RichTextEditor } from "./rich-text-editor";
import { buildInitialEditorStateJSON, isLexicalStateJSON } from "./serialize";

beforeAll(() => {
  // Lexical reads document.execCommand for some clipboard paths. jsdom doesn't
  // ship it; stub a no-op so the editor mounts.
  if (!document.execCommand) {
    document.execCommand = (() => false) as typeof document.execCommand;
  }
  // Lexical's async scrollIntoViewIfNeeded path calls
  // Range.getBoundingClientRect() after selection updates. jsdom doesn't
  // implement it; supply a zeroed-out fallback so the async commit doesn't
  // throw an unhandled rejection.
  const noopRect = (): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = noopRect;
  }
});

afterEach(cleanup);

function getEditable(container: HTMLElement): HTMLElement {
  const el = container.querySelector(
    "[contenteditable=true]",
  ) as HTMLElement | null;
  if (!el) throw new Error("editable element not found");
  return el;
}

// Lexical attaches the live editor instance to its root content-editable
// element; this is how every plugin reaches the editor. Driving the editor
// through this handle exercises the real OnChangePlugin → ValueSyncPlugin
// pipeline — synthetic `beforeinput`/keyboard events don't flush reliably
// under jsdom (no real composition or selection engine).
function getEditor(container: HTMLElement): LexicalEditor {
  const editor = getNearestEditorFromDOMNode(getEditable(container));
  if (!editor) throw new Error("Lexical editor not attached to root");
  return editor;
}

describe("RichTextEditor — initial render", () => {
  it("should show the text content of a stored Lexical JSON value", () => {
    const stored = buildInitialEditorStateJSON("Stored letter body.");
    const { container } = render(
      <RichTextEditor value={stored} onChange={vi.fn()} />,
    );
    expect(getEditable(container).textContent).toContain("Stored letter body.");
  });

  it("should render legacy Markdown content as styled text", () => {
    // Legacy rows hold raw Markdown; `**bold**` should hydrate as a styled
    // <strong>, not show the literal asterisks.
    const { container } = render(
      <RichTextEditor value="**Important** notice." onChange={vi.fn()} />,
    );
    const editable = getEditable(container);
    expect(editable.textContent).toContain("Important");
    expect(editable.textContent).not.toContain("**");
    expect(editable.querySelector("strong, b")).not.toBeNull();
  });

  it("should render an empty editor for a null value", () => {
    const { container } = render(
      <RichTextEditor value={null} onChange={vi.fn()} />,
    );
    expect(getEditable(container).textContent).toBe("");
  });
});

describe("RichTextEditor — onChange contract", () => {
  it("should not fire onChange on mount with an initial value", () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="Hi there." onChange={onChange} />);
    // Initial state is set via LexicalComposer's `editorState` config, which
    // runs before OnChangePlugin subscribes, so the parse alone is silent.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should not fire onChange on mount with a null value", () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={null} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should emit a Lexical JSON string when text is typed", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor value="" onChange={onChange} />,
    );
    const editor = getEditor(container);
    // A user edit: insert text at the caret. `editor.update` with a real
    // selection mutation is the exact path Lexical's typing handler runs;
    // synthetic `beforeinput` events don't flush reliably under jsdom.
    await act(async () => {
      editor.update(() => {
        const paragraph = $getRoot().getFirstChild();
        paragraph?.selectEnd().insertText("Typed body.");
      });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    expect(isLexicalStateJSON(emitted)).toBe(true);
  });

  it("should emit the empty string when the content becomes empty", async () => {
    // The "empty editor emits ''" contract: when content collapses to a
    // single empty paragraph, handleChange maps it to "" (via
    // isEmptyEditorState) so the caller's `value || null` nulls the column.
    // Driven here through a `value -> ""` prop change, which routes through
    // ValueSyncPlugin -> applyValueToEditor -> OnChangePlugin — the same
    // pipeline a real in-editor delete-all takes to reach handleChange.
    const onChange = vi.fn();
    const { container, rerender } = render(
      <RichTextEditor value="Delete me." onChange={onChange} />,
    );
    expect(getEditable(container).textContent).toContain("Delete me.");
    onChange.mockClear();
    await act(async () => {
      rerender(<RichTextEditor value="" onChange={onChange} />);
    });
    await waitFor(() => expect(getEditable(container).textContent).toBe(""));
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("");
  });
});

describe("RichTextEditor — ValueSyncPlugin", () => {
  it("should re-sync the editor when the value prop changes", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <RichTextEditor value="Original body." onChange={onChange} />,
    );
    expect(getEditable(container).textContent).toContain("Original body.");

    const next = buildInitialEditorStateJSON("Replacement body.");
    await act(async () => {
      rerender(<RichTextEditor value={next} onChange={onChange} />);
    });
    await waitFor(() =>
      expect(getEditable(container).textContent).toContain("Replacement body."),
    );
    expect(getEditable(container).textContent).not.toContain("Original body.");
  });

  it("should not re-sync when the value prop is unchanged", async () => {
    // ValueSyncPlugin's loop-guard: it compares incoming `value` against
    // `lastEmittedRef` (seeded with the initial value) and bails when they
    // match. A re-render with the same JSON value — the shape of a parent
    // echoing the editor's own onChange output back as `value` — must not
    // rebuild the editor or fire onChange, otherwise edits would loop.
    const stored = buildInitialEditorStateJSON("Stable body.");
    const onChange = vi.fn();
    const { container, rerender } = render(
      <RichTextEditor value={stored} onChange={onChange} />,
    );
    expect(getEditable(container).textContent).toContain("Stable body.");

    await act(async () => {
      rerender(<RichTextEditor value={stored} onChange={onChange} />);
    });
    expect(getEditable(container).textContent).toContain("Stable body.");
    expect(onChange).not.toHaveBeenCalled();
  });
});
