import { describe, it, expect } from "vitest";
import { profileFromMetadata } from "./profile";

describe("profileFromMetadata", () => {
  describe("when given fully valid metadata", () => {
    it("should pass through every field unchanged", () => {
      expect(
        profileFromMetadata({
          display_name: "Ada",
          avatar_icon_type: "animal",
          avatar_icon_value: "deer:fill",
          avatar_color_hex: "#1565c0",
        })
      ).toEqual({
        display_name: "Ada",
        avatar_icon_type: "animal",
        avatar_icon_value: "deer:fill",
        avatar_color_hex: "#1565c0",
      });
    });

    it("should ignore unrelated keys in the metadata blob", () => {
      const profile = profileFromMetadata({
        display_name: "Ada",
        avatar_icon_type: "animal",
        avatar_icon_value: "deer:fill",
        avatar_color_hex: "#1565c0",
        unrelated: "noise",
      });
      expect(profile).not.toHaveProperty("unrelated");
    });
  });

  describe("when metadata is absent", () => {
    it("should return an all-null profile for null", () => {
      expect(profileFromMetadata(null)).toEqual({
        display_name: null,
        avatar_icon_type: null,
        avatar_icon_value: null,
        avatar_color_hex: null,
      });
    });

    it("should return an all-null profile for undefined", () => {
      expect(profileFromMetadata(undefined)).toEqual({
        display_name: null,
        avatar_icon_type: null,
        avatar_icon_value: null,
        avatar_color_hex: null,
      });
    });

    it("should return an all-null profile for an empty object", () => {
      expect(profileFromMetadata({})).toEqual({
        display_name: null,
        avatar_icon_type: null,
        avatar_icon_value: null,
        avatar_color_hex: null,
      });
    });
  });

  describe("display_name", () => {
    it("should keep a non-empty string", () => {
      expect(profileFromMetadata({ display_name: "Grace" }).display_name).toBe(
        "Grace"
      );
    });

    it("should null an empty string", () => {
      expect(profileFromMetadata({ display_name: "" }).display_name).toBeNull();
    });

    it("should null a non-string value", () => {
      expect(profileFromMetadata({ display_name: 42 }).display_name).toBeNull();
    });
  });

  describe("avatar_icon_type", () => {
    it.each(["lucide", "tabler", "animal", "emoji", "svg"])(
      "should keep the valid icon type %s",
      (type) => {
        expect(profileFromMetadata({ avatar_icon_type: type }).avatar_icon_type).toBe(
          type
        );
      }
    );

    it("should null an icon type not in ICON_TYPES", () => {
      expect(
        profileFromMetadata({ avatar_icon_type: "spaceship" }).avatar_icon_type
      ).toBeNull();
    });

    it("should null a non-string icon type", () => {
      expect(
        profileFromMetadata({ avatar_icon_type: 7 }).avatar_icon_type
      ).toBeNull();
    });
  });

  describe("avatar_icon_value", () => {
    it("should keep a non-empty string", () => {
      expect(
        profileFromMetadata({ avatar_icon_value: "deer:fill" }).avatar_icon_value
      ).toBe("deer:fill");
    });

    it("should null an empty string", () => {
      expect(
        profileFromMetadata({ avatar_icon_value: "" }).avatar_icon_value
      ).toBeNull();
    });

    it("should null a non-string value", () => {
      expect(
        profileFromMetadata({ avatar_icon_value: 123 }).avatar_icon_value
      ).toBeNull();
    });
  });

  describe("avatar_color_hex", () => {
    it("should keep a valid 6-digit hex with a lowercase value", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: "#1565c0" }).avatar_color_hex
      ).toBe("#1565c0");
    });

    it("should keep a valid 6-digit hex with uppercase letters", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: "#ABCDEF" }).avatar_color_hex
      ).toBe("#ABCDEF");
    });

    it("should null a hex string missing the leading hash", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: "1565c0" }).avatar_color_hex
      ).toBeNull();
    });

    it("should null a 3-digit shorthand hex", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: "#abc" }).avatar_color_hex
      ).toBeNull();
    });

    it("should null a hex with non-hex characters", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: "#12345g" }).avatar_color_hex
      ).toBeNull();
    });

    it("should null a non-string color value", () => {
      expect(
        profileFromMetadata({ avatar_color_hex: 0x1565c0 }).avatar_color_hex
      ).toBeNull();
    });
  });
});
