import { describe, it, expect } from "vitest";
import { hasArabicPresentationForms } from "@/lib/arabic-processing";

describe("Auto-protection skip for previous build entries", () => {
  // Simulates the protection logic from useEditorState.ts lines 179-190
  function simulateProtection(
    entries: { msbtFile: string; index: number; original: string }[],
    translations: Record<string, string>
  ): Set<string> {
    const protectedSet = new Set<string>();
    const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\u0750-\u077F\u08A0-\u08FF]/;

    for (const entry of entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      if (arabicRegex.test(entry.original)) {
        // Skip protection if original contains presentation forms (from previous build)
        if (hasArabicPresentationForms(entry.original)) continue;
        const existingTranslation = translations[key]?.trim();
        if (existingTranslation && existingTranslation !== entry.original && existingTranslation !== entry.original.trim()) {
          protectedSet.add(key);
        }
      }
    }
    return protectedSet;
  }

  it("should NOT protect entries with presentation forms in original (previous build output)", () => {
    // \uFE8D\uFEE0\uFEE4\uFEA8\uFEAE\uFEAC = "المخرج" in presentation forms (from a previous build)
    const entries = [
      { msbtFile: "test.msbt", index: 0, original: "\uFE8D\uFEE0\uFEE4\uFEA8\uFEAE\uFEAC" },
    ];
    const translations = { "test.msbt:0": "ترجمة مختلفة" };

    const result = simulateProtection(entries, translations);
    expect(result.size).toBe(0); // Should NOT be protected
  });

  it("should protect entries with standard Arabic in original (external tool)", () => {
    // Standard Arabic characters (not from a previous build)
    const entries = [
      { msbtFile: "test.msbt", index: 0, original: "المخرج" },
    ];
    const translations = { "test.msbt:0": "ترجمة مختلفة" };

    const result = simulateProtection(entries, translations);
    expect(result.size).toBe(1); // Should be protected
    expect(result.has("test.msbt:0")).toBe(true);
  });

  it("should not protect if translation matches original", () => {
    const entries = [
      { msbtFile: "test.msbt", index: 0, original: "مرحبا" },
    ];
    const translations = { "test.msbt:0": "مرحبا" };

    const result = simulateProtection(entries, translations);
    expect(result.size).toBe(0);
  });

  it("should handle mixed entries correctly", () => {
    const entries = [
      // From previous build (presentation forms) - should skip
      { msbtFile: "a.msbt", index: 0, original: "\uFE8D\uFEE0\uFEE4\uFEA8\uFEAE\uFEAC" },
      // Standard Arabic with different translation - should protect
      { msbtFile: "b.msbt", index: 0, original: "القائمة" },
      // English only - should skip (no Arabic)
      { msbtFile: "c.msbt", index: 0, original: "Settings" },
    ];
    const translations = {
      "a.msbt:0": "ترجمة جديدة",
      "b.msbt:0": "ترجمة القائمة",
      "c.msbt:0": "الإعدادات",
    };

    const result = simulateProtection(entries, translations);
    expect(result.size).toBe(1);
    expect(result.has("b.msbt:0")).toBe(true);
    expect(result.has("a.msbt:0")).toBe(false);
  });
});
