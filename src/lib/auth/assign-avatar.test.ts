import { describe, it, expect, afterEach, vi } from "vitest";
import { pickRandomAvatar } from "./assign-avatar";
import { ANIMALS } from "@/lib/animals";
import { makeUserAvatarData } from "../../../tests/fixtures/builders";

// pickRandomAvatar always consults Math.random (animal pick, and the
// empty-existing-colors color pick). Stub it per the protocol's mocking
// policy so every assertion below is deterministic.

describe("pickRandomAvatar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("result shape", () => {
    it("should return an animal icon type with a :fill-suffixed value and a hex color", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);

      const result = pickRandomAvatar([]);

      expect(result).toEqual({
        avatar_icon_type: "animal",
        avatar_icon_value: `${ANIMALS[0].slug}:fill`,
        avatar_color_hex: expect.stringMatching(/^#[0-9a-f]{6}$/),
      });
    });
  });

  describe("animal selection", () => {
    it("should pick the first pool animal when Math.random is 0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);

      expect(pickRandomAvatar([]).avatar_icon_value).toBe(
        `${ANIMALS[0].slug}:fill`
      );
    });

    it("should skip an animal slug already used by an existing profile", () => {
      // Math.random -> 0 selects index 0 of the *filtered* pool. With the
      // first animal taken, that becomes the second animal in ANIMALS.
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [
        makeUserAvatarData({
          avatar_icon_type: "animal",
          avatar_icon_value: `${ANIMALS[0].slug}:fill`,
        }),
      ];

      expect(pickRandomAvatar(existing).avatar_icon_value).toBe(
        `${ANIMALS[1].slug}:fill`
      );
    });

    it("should ignore an existing profile whose icon type is not animal", () => {
      // An emoji icon that happens to carry ANIMALS[0].slug must not be
      // treated as a used animal slug.
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [
        makeUserAvatarData({
          avatar_icon_type: "emoji",
          avatar_icon_value: `${ANIMALS[0].slug}:fill`,
        }),
      ];

      expect(pickRandomAvatar(existing).avatar_icon_value).toBe(
        `${ANIMALS[0].slug}:fill`
      );
    });

    it("should fall back to the full animal list once every slug is used", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = ANIMALS.map((a) =>
        makeUserAvatarData({
          avatar_icon_type: "animal",
          avatar_icon_value: `${a.slug}:fill`,
        })
      );

      // Pool is empty, so source is the full ANIMALS list; index 0 again.
      expect(pickRandomAvatar(existing).avatar_icon_value).toBe(
        `${ANIMALS[0].slug}:fill`
      );
    });
  });

  describe("color selection when existing profiles have colors", () => {
    // These cases are deterministic regardless of Math.random: pickDistinctColor
    // takes the existing-hue branch. Math.random is still stubbed because the
    // animal pick reads it.
    it("should pick the palette color most hue-distant from a single red", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [makeUserAvatarData({ avatar_color_hex: "#c62828" })];

      // #c62828 is hue ~0; the farthest palette entry is dark cyan #006064.
      expect(pickRandomAvatar(existing).avatar_color_hex).toBe("#006064");
    });

    it("should pick the palette color most hue-distant from a single sky blue", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [makeUserAvatarData({ avatar_color_hex: "#01579b" })];

      // #01579b is hue ~207; the farthest palette entry is deep orange #bf360c.
      expect(pickRandomAvatar(existing).avatar_color_hex).toBe("#bf360c");
    });

    it("should maximise the minimum distance across multiple existing colors", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [
        makeUserAvatarData({ avatar_color_hex: "#c62828" }), // red ~0
        makeUserAvatarData({ avatar_color_hex: "#1565c0" }), // blue ~212
      ];

      // The palette entry whose nearest neighbour is farthest is green #2e7d32.
      expect(pickRandomAvatar(existing).avatar_color_hex).toBe("#2e7d32");
    });

    it("should ignore existing profiles with a null color", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const existing = [
        makeUserAvatarData({ avatar_color_hex: "#c62828" }),
        makeUserAvatarData({ avatar_color_hex: null }),
      ];

      // Same result as the single-red case: the null color contributes nothing.
      expect(pickRandomAvatar(existing).avatar_color_hex).toBe("#006064");
    });
  });

  describe("color selection when no existing profiles have colors", () => {
    it("should pick a palette color via Math.random", () => {
      // Math.random -> 0 selects the first palette entry, red.
      vi.spyOn(Math, "random").mockReturnValue(0);

      expect(pickRandomAvatar([]).avatar_color_hex).toBe("#c62828");
    });

    it("should pick the last palette entry when Math.random is near 1", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999);

      expect(pickRandomAvatar([]).avatar_color_hex).toBe("#ad1457");
    });
  });
});
