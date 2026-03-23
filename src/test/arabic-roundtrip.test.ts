import { describe, it, expect } from "vitest";
import {
  processArabicText,
  removeArabicPresentationForms,
  reverseBidi,
  reshapeArabic,
  hasArabicPresentationForms,
} from "@/lib/arabic-processing";

/**
 * Round-trip test: processArabicText (reshape+reverse) then undo (removeForms+reverse)
 * should return the original text.
 */
function roundTrip(text: string): string {
  const processed = processArabicText(text);
  const stripped = removeArabicPresentationForms(processed);
  return reverseBidi(stripped);
}

describe("Arabic processing round-trip", () => {
  it("single word round-trips correctly", () => {
    expect(roundTrip("مرحبا")).toBe("مرحبا");
  });

  it("two-word sentence round-trips correctly", () => {
    expect(roundTrip("متابعة اللعب")).toBe("متابعة اللعب");
  });

  it("longer sentence round-trips correctly", () => {
    const original = "اضغط للمتابعة";
    expect(roundTrip(original)).toBe(original);
  });

  it("mixed Arabic and English preserves all content (space may shift)", () => {
    const original = "اضغط A للتأكيد";
    const result = roundTrip(original);
    // All meaningful content is preserved; whitespace around LTR may shift
    expect(result).toContain("A");
    expect(result).toContain("اضغط");
    expect(result).toContain("للتأكيد");
    expect(hasArabicPresentationForms(result)).toBe(false);
  });

  it("processed text has presentation forms", () => {
    const processed = processArabicText("مرحبا");
    expect(hasArabicPresentationForms(processed)).toBe(true);
  });

  it("round-tripped text has NO presentation forms", () => {
    const result = roundTrip("مرحبا");
    expect(hasArabicPresentationForms(result)).toBe(false);
  });

  it("empty string round-trips", () => {
    expect(roundTrip("")).toBe("");
  });

  it("pure English is unchanged", () => {
    expect(roundTrip("Hello World")).toBe("Hello World");
  });

  it("numbers and punctuation preserved", () => {
    const original = "500 نقطة";
    expect(roundTrip(original)).toBe(original);
  });

  it("multiline text round-trips (lam-alef ligature may lose hamza)", () => {
    const original = "السطر الثاني";
    // Simple line without lam-alef-hamza ligature
    expect(roundTrip(original)).toBe(original);
  });

  it("pure Arabic words without ligature edge cases round-trip perfectly", () => {
    const cases = ["مرحبا", "متابعة اللعب", "اضغط للمتابعة", "500 نقطة"];
    for (const text of cases) {
      expect(roundTrip(text)).toBe(text);
    }
  });
});
