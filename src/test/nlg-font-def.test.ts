import { describe, it, expect } from "vitest";
import {
  parseNLGFontDef,
  serializeNLGFontDef,
  mergeArabicIntoFontDef,
  generateArabicGlyphEntries,
  type NLGFontDef,
  type NLGGlyphEntry,
} from "@/lib/nlg-font-def";

const SAMPLE_FONT_DEF = `
Font "LM2_English15" 15 color 255 255 255
PageSize 1024 PageCount 2 TextType color Distribution english
Height 25 RenderHeight 32 Ascent 26 RenderAscent 26 IL 10
CharSpacing 0 LineHeight 0
Glyph 32 Width 5 5 0 0 0 0 0 0
Glyph ! Width 6 8 1 3 2 9 27 0
Glyph A Width 14 14 0 85 2 99 27 0
Glyph B Width 12 13 1 100 2 112 27 0
Glyph 48 Width 11 12 1 200 2 211 27 0
`;

describe("parseNLGFontDef", () => {
  it("parses header correctly", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    expect(def.header.fontName).toBe("LM2_English15");
    expect(def.header.fontSize).toBe(15);
    expect(def.header.colorR).toBe(255);
    expect(def.header.pageSize).toBe(1024);
    expect(def.header.pageCount).toBe(2);
    expect(def.header.height).toBe(25);
    expect(def.header.renderHeight).toBe(32);
    expect(def.header.ascent).toBe(26);
    expect(def.header.charSpacing).toBe(0);
    expect(def.header.lineHeight).toBe(0);
  });

  it("parses glyphs correctly", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    expect(def.glyphs.length).toBe(5);

    // Space (code 32)
    const space = def.glyphs.find(g => g.code === 32)!;
    expect(space).toBeDefined();
    expect(space.width).toBe(5);
    expect(space.charSpec).toBe("32");

    // '!' single char
    const excl = def.glyphs.find(g => g.code === 33)!;
    expect(excl).toBeDefined();
    expect(excl.charSpec).toBe("!");
    expect(excl.width).toBe(6);
    expect(excl.renderWidth).toBe(8);
    expect(excl.xOffset).toBe(1);
    expect(excl.x1).toBe(3);
    expect(excl.y1).toBe(2);
    expect(excl.x2).toBe(9);
    expect(excl.y2).toBe(27);
    expect(excl.page).toBe(0);

    // 'A'
    const a = def.glyphs.find(g => g.code === 65)!;
    expect(a.width).toBe(14);

    // '0' via decimal code 48
    const zero = def.glyphs.find(g => g.code === 48)!;
    expect(zero).toBeDefined();
    expect(zero.charSpec).toBe("48");
  });

  it("stores rawText", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    expect(def.rawText).toBe(SAMPLE_FONT_DEF);
  });
});

describe("serializeNLGFontDef", () => {
  it("round-trips header values", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const text = serializeNLGFontDef(def);

    expect(text).toContain('Font "LM2_English15" 15 color 255 255 255');
    expect(text).toContain("PageSize 1024 PageCount 2 TextType color Distribution english");
    expect(text).toContain("Height 25 RenderHeight 32 Ascent 26 RenderAscent 26 IL 10");
    expect(text).toContain("CharSpacing 0 LineHeight 0");
  });

  it("round-trips glyphs", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const text = serializeNLGFontDef(def);

    expect(text).toContain("Glyph ! Width 6 8 1 3 2 9 27 0");
    expect(text).toContain("Glyph A Width 14 14 0 85 2 99 27 0");
  });

  it("re-parses to same data", () => {
    const def1 = parseNLGFontDef(SAMPLE_FONT_DEF);
    const text = serializeNLGFontDef(def1);
    const def2 = parseNLGFontDef(text);

    expect(def2.header).toEqual(def1.header);
    expect(def2.glyphs.length).toBe(def1.glyphs.length);
    for (let i = 0; i < def1.glyphs.length; i++) {
      expect(def2.glyphs[i].code).toBe(def1.glyphs[i].code);
      expect(def2.glyphs[i].width).toBe(def1.glyphs[i].width);
      expect(def2.glyphs[i].x1).toBe(def1.glyphs[i].x1);
      expect(def2.glyphs[i].page).toBe(def1.glyphs[i].page);
    }
  });
});

describe("mergeArabicIntoFontDef", () => {
  const arabicEntries: NLGGlyphEntry[] = [
    { charSpec: "1576", code: 0x0628, width: 10, renderWidth: 12, xOffset: 1, x1: 0, y1: 0, x2: 10, y2: 20, page: 2 },
    { charSpec: "1578", code: 0x062A, width: 10, renderWidth: 12, xOffset: 1, x1: 12, y1: 0, x2: 22, y2: 20, page: 2 },
    { charSpec: "65166", code: 0xFE8E, width: 8, renderWidth: 10, xOffset: 0, x1: 0, y1: 22, x2: 8, y2: 42, page: 2 },
  ];

  it("adds Arabic glyphs and preserves Latin", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const merged = mergeArabicIntoFontDef(def, arabicEntries, 3);

    // Original had 5 latin glyphs
    const latinGlyphs = merged.glyphs.filter(g => g.code < 0x0600);
    expect(latinGlyphs.length).toBe(5);

    // Arabic added
    const arabGlyphs = merged.glyphs.filter(g => g.code >= 0x0600);
    expect(arabGlyphs.length).toBe(3);

    expect(merged.glyphs.length).toBe(8);
  });

  it("updates PageCount", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const merged = mergeArabicIntoFontDef(def, arabicEntries, 3);
    expect(merged.header.pageCount).toBe(3);
  });

  it("sorts glyphs by code point", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const merged = mergeArabicIntoFontDef(def, arabicEntries, 3);

    for (let i = 1; i < merged.glyphs.length; i++) {
      expect(merged.glyphs[i].code).toBeGreaterThanOrEqual(merged.glyphs[i - 1].code);
    }
  });

  it("replaces existing Arabic glyphs on re-merge", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const merged1 = mergeArabicIntoFontDef(def, arabicEntries, 3);

    // Re-merge with different entries
    const newEntries: NLGGlyphEntry[] = [
      { charSpec: "1576", code: 0x0628, width: 15, renderWidth: 16, xOffset: 2, x1: 0, y1: 0, x2: 15, y2: 25, page: 2 },
    ];
    const merged2 = mergeArabicIntoFontDef(merged1, newEntries, 3);

    const arabGlyphs = merged2.glyphs.filter(g => g.code >= 0x0600);
    expect(arabGlyphs.length).toBe(1);
    expect(arabGlyphs[0].width).toBe(15);
  });

  it("serializes merged def correctly", () => {
    const def = parseNLGFontDef(SAMPLE_FONT_DEF);
    const merged = mergeArabicIntoFontDef(def, arabicEntries, 3);
    const text = serializeNLGFontDef(merged);

    expect(text).toContain("PageCount 3");
    expect(text).toContain("Glyph 1576 Width 10");
    expect(text).toContain("Glyph A Width 14");

    // Verify round-trip
    const reparsed = parseNLGFontDef(text);
    expect(reparsed.glyphs.length).toBe(8);
    expect(reparsed.header.pageCount).toBe(3);
  });
});

describe("generateArabicGlyphEntries", () => {
  it("generates entries from atlas glyphs", () => {
    const atlasGlyphs = [
      { char: "ب", code: 0x0628, atlasX: 5, atlasY: 10, width: 12, height: 20, advance: 14, bearingX: 1, page: 0 },
      { char: "ت", code: 0x062A, atlasX: 20, atlasY: 10, width: 12, height: 20, advance: 14, bearingX: 0, page: 0 },
    ];

    const entries = generateArabicGlyphEntries(atlasGlyphs, 2, 32);
    expect(entries.length).toBe(2);
    expect(entries[0].code).toBe(0x0628);
    expect(entries[0].page).toBe(2); // basePageIndex applied
    expect(entries[0].x1).toBe(5);
    expect(entries[0].y1).toBe(10);
    expect(entries[0].x2).toBe(17); // atlasX + width
    expect(entries[0].y2).toBe(30); // atlasY + height
    expect(entries[0].width).toBe(14); // advance
  });

  it("skips zero-width glyphs", () => {
    const atlasGlyphs = [
      { char: " ", code: 32, atlasX: 0, atlasY: 0, width: 0, height: 0, advance: 5, bearingX: 0, page: 0 },
    ];
    const entries = generateArabicGlyphEntries(atlasGlyphs, 2, 32);
    expect(entries.length).toBe(0);
  });

  it("uses decimal charSpec for non-ASCII", () => {
    const atlasGlyphs = [
      { char: "ب", code: 0x0628, atlasX: 0, atlasY: 0, width: 10, height: 20, advance: 12, bearingX: 0, page: 0 },
    ];
    const entries = generateArabicGlyphEntries(atlasGlyphs, 0, 32);
    expect(entries[0].charSpec).toBe("1576"); // decimal of 0x0628
  });
});
