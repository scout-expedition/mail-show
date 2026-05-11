import { describe, expect, it } from "vitest";
import { canDeleteUser, validateEmail, validatePassword } from "./validation";

describe("validateEmail", () => {
  it("accepts a valid email and lowercases + trims it", () => {
    expect(validateEmail("  Foo@Example.COM ")).toEqual({
      ok: true,
      email: "foo@example.com",
    });
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["nope", "no @"],
    ["a@b", "no dot"],
    ["a @b.co", "internal whitespace"],
  ])("rejects %s (%s)", (input) => {
    const result = validateEmail(input);
    expect(result.ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateEmail(undefined).ok).toBe(false);
    expect(validateEmail(123).ok).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts an 8-char password that matches the confirmation", () => {
    expect(validatePassword("hunter22", "hunter22")).toEqual({ ok: true });
  });

  it("rejects a password shorter than 8 chars", () => {
    expect(validatePassword("short", "short")).toEqual({
      ok: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("rejects when password and confirmation don't match", () => {
    expect(validatePassword("hunter22", "hunter23")).toEqual({
      ok: false,
      error: "Passwords don't match",
    });
  });

  it("rejects non-string input", () => {
    expect(validatePassword(undefined, "hunter22").ok).toBe(false);
    expect(validatePassword("hunter22", null).ok).toBe(false);
  });
});

describe("canDeleteUser", () => {
  it("returns false when the current user is the delete target", () => {
    expect(canDeleteUser("user-1", "user-1")).toBe(false);
  });

  it("returns true when the current user is deleting someone else", () => {
    expect(canDeleteUser("user-1", "user-2")).toBe(true);
  });
});
