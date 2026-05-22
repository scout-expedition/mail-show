import { describe, expect, it } from "vitest";
import {
  resolveVariableIcon,
  type NationIconRef,
} from "./variable-kind-icon";
import type { VariableState } from "./block-state";

function v(partial: Partial<VariableState> & Pick<VariableState, "kind">): VariableState {
  return {
    id: partial.id ?? "vid",
    name: partial.name ?? "v",
    kind: partial.kind,
    number_ref: partial.number_ref ?? null,
    aggregate_ref: partial.aggregate_ref ?? null,
    default_value_id: null,
    color_index: 0,
    color_hex: null,
    folder_id: null,
    sort_order: 0,
  };
}

const NATIONS: NationIconRef[] = [
  { name: "Folos", color_hex: "#aaa", icon_type: "tabler", icon_value: "IconFlame" },
  { name: "Emberlyn", color_hex: "#bbb", icon_type: "lucide", icon_value: "Mountain" },
  { name: "Spokgrad", color_hex: "#ccc", icon_type: "animal", icon_value: "wolf:outline" },
  // Edge: row exists but icon_value missing.
  { name: "Pelico", color_hex: "#ddd", icon_type: "tabler", icon_value: null },
];

describe("resolveVariableIcon", () => {
  it("maps text variables to the Hash lucide glyph", () => {
    expect(resolveVariableIcon(v({ kind: "text" }), NATIONS)).toEqual({
      source: "lucide",
      name: "Hash",
    });
  });

  it("maps smart variables to the Atom lucide glyph", () => {
    expect(resolveVariableIcon(v({ kind: "smart_ref" }), NATIONS)).toEqual({
      source: "lucide",
      name: "Atom",
    });
  });

  it("maps aggregate variables to the Sigma lucide glyph", () => {
    expect(resolveVariableIcon(v({ kind: "aggregate_ref", aggregate_ref: "class_affinity" }), NATIONS)).toEqual({
      source: "lucide",
      name: "Sigma",
    });
  });

  it.each([
    ["world_status", "IconWorldBolt"],
    ["demerits", "IconCircleMinus"],
    ["proletariat", "IconHammer"],
    ["gentry", "IconDiamond"],
  ])("maps impact/class number_ref %s to tabler %s", (ref, expected) => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: ref }), NATIONS)).toEqual({
      source: "stored",
      iconType: "tabler",
      iconValue: expected,
    });
  });

  it("honors a nation's icon_type when it is tabler", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "folos" }), NATIONS)).toEqual({
      source: "stored",
      iconType: "tabler",
      iconValue: "IconFlame",
    });
  });

  it("honors a nation's icon_type when it is lucide (not just tabler)", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "emberlyn" }), NATIONS)).toEqual({
      source: "stored",
      iconType: "lucide",
      iconValue: "Mountain",
    });
  });

  it("honors a nation's icon_type when it is animal", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "spokgrad" }), NATIONS)).toEqual({
      source: "stored",
      iconType: "animal",
      iconValue: "wolf:outline",
    });
  });

  it("matches a nation case-insensitively", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "FOLOS" }), NATIONS)).toEqual({
      source: "stored",
      iconType: "tabler",
      iconValue: "IconFlame",
    });
  });

  it("falls back to Globe when the nation row has no icon_value", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "pelico" }), NATIONS)).toEqual({
      source: "lucide",
      name: "Globe",
    });
  });

  it("falls back to Globe when no nation matches the number_ref", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: "atlantis" }), NATIONS)).toEqual({
      source: "lucide",
      name: "Globe",
    });
  });

  it("falls back to Globe when number_ref is null", () => {
    expect(resolveVariableIcon(v({ kind: "number_ref", number_ref: null }), NATIONS)).toEqual({
      source: "lucide",
      name: "Globe",
    });
  });
});
