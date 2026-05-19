import { describe, expect, it } from "vitest";
import {
  formatLetterInput,
  formatRomanInput,
  intToLetter,
  intToRoman,
  isValidRoman,
  letterToInt,
  romanToInt,
} from "./id-tokens";

describe("intToRoman", () => {
  it("converts positive integers to lowercase roman numerals", () => {
    expect(intToRoman(1)).toBe("i");
    expect(intToRoman(4)).toBe("iv");
    expect(intToRoman(9)).toBe("ix");
    expect(intToRoman(14)).toBe("xiv");
    expect(intToRoman(40)).toBe("xl");
    expect(intToRoman(2024)).toBe("mmxxiv");
  });

  it("returns an empty string for non-positive input", () => {
    expect(intToRoman(0)).toBe("");
    expect(intToRoman(-3)).toBe("");
  });
});

describe("romanToInt", () => {
  it("parses canonical lowercase roman numerals", () => {
    expect(romanToInt("i")).toBe(1);
    expect(romanToInt("iv")).toBe(4);
    expect(romanToInt("ix")).toBe(9);
    expect(romanToInt("xiv")).toBe(14);
  });

  it("normalises case and surrounding whitespace", () => {
    expect(romanToInt("  IV ")).toBe(4);
  });

  it("rejects empty, non-roman, and non-canonical forms", () => {
    expect(romanToInt("")).toBeNull();
    expect(romanToInt("abc")).toBeNull();
    expect(romanToInt("iiii")).toBeNull(); // 4 must be written "iv"
    expect(romanToInt("vv")).toBeNull();
  });

  it("round-trips with intToRoman across a range", () => {
    for (let n = 1; n <= 100; n++) {
      expect(romanToInt(intToRoman(n))).toBe(n);
    }
  });
});

describe("isValidRoman", () => {
  it("reflects romanToInt validity", () => {
    expect(isValidRoman("iii")).toBe(true);
    expect(isValidRoman("iiii")).toBe(false);
    expect(isValidRoman("")).toBe(false);
  });
});

describe("formatRomanInput", () => {
  it("lowercases and strips non-roman characters", () => {
    expect(formatRomanInput("XiV")).toBe("xiv");
    expect(formatRomanInput("i.v 9")).toBe("iv");
    expect(formatRomanInput("hello")).toBe("ll"); // only the l's survive
  });
});

describe("letterToInt", () => {
  it("maps a single a–z letter to its 1-based position", () => {
    expect(letterToInt("a")).toBe(1);
    expect(letterToInt("z")).toBe(26);
    expect(letterToInt(" B ")).toBe(2);
  });

  it("rejects non-single-letter input", () => {
    expect(letterToInt("")).toBeNull();
    expect(letterToInt("ab")).toBeNull();
    expect(letterToInt("1")).toBeNull();
  });
});

describe("intToLetter", () => {
  it("maps 1-based positions back to letters", () => {
    expect(intToLetter(1)).toBe("a");
    expect(intToLetter(26)).toBe("z");
  });

  it("returns an empty string outside 1–26", () => {
    expect(intToLetter(0)).toBe("");
    expect(intToLetter(27)).toBe("");
  });

  it("round-trips with letterToInt", () => {
    for (let n = 1; n <= 26; n++) {
      expect(letterToInt(intToLetter(n))).toBe(n);
    }
  });
});

describe("formatLetterInput", () => {
  it("takes the first a–z character, lowercased", () => {
    expect(formatLetterInput("B")).toBe("b");
    expect(formatLetterInput("3c")).toBe("c");
    expect(formatLetterInput("123")).toBe("");
  });
});
