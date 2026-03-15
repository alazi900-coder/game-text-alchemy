import { describe, it, expect } from "vitest";
import { protectTags, restoreTags } from "@/lib/tag-protection";

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
    expect(tags.length).toBeGreaterThan(0);
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });

  it("protects Cobalt $Arg(0) and $Icon tags", () => {
    const text = 'Press $Icon("A") to confirm $Arg(0)';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain("$Icon");
    expect(cleanText).not.toContain("$Arg");
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });

  it("protects simple Cobalt $ tags like $P $n $t", () => {
    const text = "Hello $P, press $n to continue";
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain("$P");
    expect(cleanText).not.toContain("$n");
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });

  it("protects format specifiers %s and %d", () => {
    const text = "You have %d items worth %s gold";
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain("%d");
    expect(cleanText).not.toContain("%s");
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });

  it("protects [MID_...] identifiers", () => {
    const text = "[MID_MENU_YES]\nابدأ اللعبة";
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain("[MID_MENU_YES]");
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });
});
