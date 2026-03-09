import { describe, it, expect } from "vitest";
import { protectTags, restoreTags } from "@/lib/xc3-tag-protection";

describe("Translation edge cases", () => {
  it("handles empty translation text", () => {
    const result = protectTags("");
    expect(result.cleanText).toBe("");
    expect(result.tags).toHaveLength(0);
  });

  it("handles text with only tags and no translatable content", () => {
    const text = "\uE001\uE002[ML:Dash ]";
    const result = protectTags(text);
    // All content should be protected
    expect(result.tags.length).toBeGreaterThan(0);
    // Clean text should only have placeholders
    expect(result.cleanText).not.toContain("\uE001");
    expect(result.cleanText).not.toContain("[ML:");
  });

  it("restores tags correctly after translation simulation", () => {
    const original = "\uE001Hello [ML:Dash ]world";
    const { cleanText, tags } = protectTags(original);
    // Simulate translation by replacing English words
    const translated = cleanText.replace("Hello ", "مرحبا ").replace("world", "عالم");
    const restored = restoreTags(translated, tags);
    expect(restored).toContain("\uE001");
    expect(restored).toContain("[ML:Dash ]");
    expect(restored).toContain("مرحبا");
    expect(restored).toContain("عالم");
  });

  it("handles whitespace-only translation", () => {
    const result = protectTags("   \n\t  ");
    expect(result.cleanText).toBe("   \n\t  ");
    expect(result.tags).toHaveLength(0);
  });

  it("preserves game abbreviations as protected tags", () => {
    const text = "You gained 500 EXP and 10 SP";
    const { cleanText, tags } = protectTags(text);
    const hasEXP = tags.some(t => t.original === "EXP");
    const hasSP = tags.some(t => t.original === "SP");
    expect(hasEXP).toBe(true);
    expect(hasSP).toBe(true);
  });

  it("handles multiple consecutive PUA icons as single block", () => {
    const text = "\uE001\uE002\uE003 some text";
    const { tags } = protectTags(text);
    // Consecutive PUA should be one tag
    const puaTag = tags.find(t => t.original.includes("\uE001"));
    expect(puaTag).toBeDefined();
    expect(puaTag!.original).toBe("\uE001\uE002\uE003");
  });

  it("handles nested/complex tag patterns", () => {
    const text = "[System:Ruby rt=カタカナ ]テスト[/System:Ruby]";
    const { cleanText, tags } = protectTags(text);
    // The paired tag should be protected as one unit
    expect(tags.length).toBeGreaterThan(0);
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });
});
