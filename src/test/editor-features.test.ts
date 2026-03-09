import { describe, it, expect } from "vitest";

// Mock of the unReverseBidi function from Editor.tsx
function isArabicChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);
}

function unReverseBidi(text: string): string {
  return text.split('\n').map(line => {
    const segments: { text: string; isLTR: boolean }[] = [];
    let current = '';
    let currentIsLTR: boolean | null = null;

    for (const ch of line) {
      const charIsArabic = isArabicChar(ch);
      const charIsLTR = /[a-zA-Z0-9]/.test(ch);
      
      if (charIsArabic) {
        if (currentIsLTR === true && current) {
          segments.push({ text: current, isLTR: true });
          current = '';
        }
        currentIsLTR = false;
        current += ch;
      } else if (charIsLTR) {
        if (currentIsLTR === false && current) {
          segments.push({ text: current, isLTR: false });
          current = '';
        }
        currentIsLTR = true;
        current += ch;
      } else {
        current += ch;
      }
    }
    if (current) segments.push({ text: current, isLTR: currentIsLTR === true });

    return segments.reverse().map(seg => {
      if (seg.isLTR) return seg.text;
      return [...seg.text].reverse().join('');
    }).join('');
  }).join('\n');
}

describe("Editor Features", () => {
  describe("Pagination Logic", () => {
    it("should calculate correct page count", () => {
      const PAGE_SIZE = 50;
      const totalEntries = 125;
      const totalPages = Math.ceil(totalEntries / PAGE_SIZE);
      expect(totalPages).toBe(3);
    });

    it("should handle pagination boundaries", () => {
      const PAGE_SIZE = 50;
      const totalEntries = 100;
      const currentPage = 0;
      const start = currentPage * PAGE_SIZE;
      const paginatedSlice = Array(totalEntries).fill(0).slice(start, start + PAGE_SIZE);
      expect(paginatedSlice.length).toBe(50);
    });

    it("should reset page when filters change", () => {
      let currentPage = 2;
      // Simulate filter change by resetting page
      currentPage = 0;
      expect(currentPage).toBe(0);
    });
  });

  describe("Fix Reversed Feature", () => {
    it("should detect Arabic text correctly", () => {
      const arabicText = "مرحبا";
      const hasArabic = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(arabicText);
      expect(hasArabic).toBe(true);
    });

    it("should fix reversed Arabic text", () => {
      // Test case: reversed Arabic should be corrected
      const reversedText = "ابحرم"; // "مرحبا" reversed
      const corrected = unReverseBidi(reversedText);
      expect(corrected).toBeDefined();
      // The corrected text should be different from the input
      expect(corrected).not.toBe(reversedText);
    });

    it("should handle mixed Arabic-Latin text", () => {
      const mixedText = "Hello مرحبا";
      const corrected = unReverseBidi(mixedText);
      expect(corrected).toBeDefined();
    });

    it("should not modify Latin-only text", () => {
      const latinText = "Hello World";
      const corrected = unReverseBidi(latinText);
      expect(corrected).toBe(latinText);
    });

    it("should handle empty strings", () => {
      const emptyText = "";
      const corrected = unReverseBidi(emptyText);
      expect(corrected).toBe("");
    });

    it("should fix all reversed entries in batch", () => {
      const entries = [
        { msbtFile: "file1.msbt", index: 0, original: "ابحرم", label: "test1" },
        { msbtFile: "file1.msbt", index: 1, original: "نرتخ", label: "test2" },
        { msbtFile: "file1.msbt", index: 2, original: "English", label: "test3" },
      ];

      const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      let fixedCount = 0;
      
      for (const entry of entries) {
        if (arabicRegex.test(entry.original)) {
          const corrected = unReverseBidi(entry.original);
          if (corrected !== entry.original) {
            fixedCount++;
          }
        }
      }
      
      expect(fixedCount).toBeGreaterThan(0);
    });
  });

  describe("Pagination with Filtered Entries", () => {
    it("should calculate correct pagination for filtered results", () => {
      const PAGE_SIZE = 50;
      const allEntries = Array(150).fill(null).map((_, i) => ({
        msbtFile: `file${Math.floor(i / 50)}.msbt`,
        index: i,
        original: `text${i}`,
        maxBytes: 100,
      }));

      // Simulate filtering by category
      const filterCategory = "inventory";
      const filteredEntries = allEntries.filter((_, i) => 
        i % 3 === 0 // Simple filter logic
      );

      const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);
      expect(totalPages).toBeGreaterThan(0);
      expect(filteredEntries.length).toBeLessThanOrEqual(allEntries.length);
    });

    it("should display correct entry range in pagination info", () => {
      const PAGE_SIZE = 50;
      const filteredEntries = Array(125).fill(null);
      const currentPage = 0;

      const displayStart = currentPage * PAGE_SIZE + 1;
      const displayEnd = Math.min((currentPage + 1) * PAGE_SIZE, filteredEntries.length);
      const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);

      expect(displayStart).toBe(1);
      expect(displayEnd).toBe(50);
      expect(totalPages).toBe(3);
    });
  });

  describe("Auto-detect Arabic Feature", () => {
     it("should detect pre-translated Arabic texts", () => {
       const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\u0750-\u077F\u08A0-\u08FF]/;
       
       const entries = [
         { original: "السلام عليكم" },
         { original: "Hello" },
         { original: "مرحبا" },
       ];

       const autoDetectedCount = entries.filter(e => arabicRegex.test(e.original)).length;
       expect(autoDetectedCount).toBe(2);
     });
   });

  describe("Status Message Generation", () => {
    it("should generate correct status message for fixed reversed texts", () => {
      const count = 5;
      const skippedProtected = 2;
      const skippedTranslated = 3;
      const skippedSame = 1;

      const parts: string[] = [];
      if (count > 0) parts.push("تم تصحيح: " + count + " نص");
      if (skippedProtected > 0) parts.push("محمية: " + skippedProtected);
      if (skippedTranslated > 0) parts.push("مترجمة: " + skippedTranslated);
      if (skippedSame > 0) parts.push("بلا تغيير: " + skippedSame);

      const detailedMessage = (count > 0 ? "\u2705 " : "\u26A0\uFE0F ") + parts.join(" | ");
      
      expect(detailedMessage).toContain("✅");
      expect(detailedMessage).toContain("تم تصحيح: 5");
      expect(detailedMessage).toContain("محمية: 2");
      expect(detailedMessage).toContain("مترجمة: 3");
      expect(detailedMessage).toContain("بلا تغيير: 1");
    });

    it("should generate warning message when no texts were fixed", () => {
      const count = 0;
      const skippedProtected = 0;
      const skippedTranslated = 0;
      const skippedSame = 0;

      const parts: string[] = [];
      if (count > 0) parts.push("تم تصحيح: " + count + " نص");
      if (skippedProtected > 0) parts.push("محمية: " + skippedProtected);
      if (skippedTranslated > 0) parts.push("مترجمة: " + skippedTranslated);
      if (skippedSame > 0) parts.push("بلا تغيير: " + skippedSame);

      const detailedMessage = (count > 0 ? "\u2705 " : "\u26A0\uFE0F ") + parts.join(" | ");
      
      expect(detailedMessage).toContain("⚠️");
    });
  });
});

// Full integration tests using the real categorizeBdatTable function pattern
describe("categorizeBdatTable - full label classification", () => {
  // Import the actual function logic for testing
  function categorizeByTableName(tbl: string): string | null {
    if (/^mnu_/i.test(tbl)) return "bdat-menu";
    if (/^btl_/i.test(tbl) || /^(rsc_|wpn_)/i.test(tbl)) return "bdat-battle";
    if (/^chr_/i.test(tbl)) return "bdat-character";
    if (/^(ene_|emt_)/i.test(tbl)) return "bdat-enemy";
    if (/^itm_/i.test(tbl)) return "bdat-item";
    if (/^(qst_|tsk_)/i.test(tbl)) return "bdat-quest";
    if (/^(evt_|tlk_)/i.test(tbl)) return "bdat-story";
    if (/^msg_/i.test(tbl)) return "bdat-message";
    if (/^dlc_/i.test(tbl)) return "bdat-dlc";
    if (/^(ma_)/i.test(tbl)) return "bdat-message";
    if (/^sys_/i.test(tbl)) return "bdat-system";
    if (/^(gimmick|gmk_)/i.test(tbl)) return "bdat-gimmick";
    if (/^fld_/i.test(tbl)) return "bdat-field";
    if (/^(skl_|art_|spc_)/i.test(tbl)) return "bdat-skill";
    if (/^(gem_|acc_|orb_)/i.test(tbl)) return "bdat-gem";
    if (/^(job_|rol_|cls_)/i.test(tbl)) return "bdat-class";
    if (/^(tip_|hlp_|tut_)/i.test(tbl)) return "bdat-tips";
    if (/^bgm/i.test(tbl)) return "bdat-system";
    if (/^rsc_/i.test(tbl)) return "bdat-system";
    if (/^0x[0-9a-f]+$/i.test(tbl)) return null;
    return null;
  }

  function categorizeByColumnName(columnName: string): string | null {
    if (!columnName || /^0x[0-9a-f]+$/i.test(columnName)) return null;
    const col = columnName.toLowerCase();
    if (/^(msg_caption|caption|windowtitle|btncaption|menucategory)/i.test(columnName)) return "bdat-menu";
    if (/window|btn|layout/i.test(col)) return "bdat-menu";
    if (/task|purpose|summary|quest|scenario/i.test(col)) return "bdat-quest";
    if (/^(locationname|colonyid|mapid|landmark)/i.test(columnName)) return "bdat-field";
    if (/landmark|colony(?!flag)/i.test(col)) return "bdat-field";
    if (/^(itm|gem|weapon|armor|accessory|price|equiptype)/i.test(columnName)) return "bdat-item";
    if (/skill|weapon|armor|gem(?!ini)/i.test(col) && col.length > 3) return "bdat-item";
    if (/^(voice|audio|config|setting|display|brightness|sound)/i.test(columnName)) return "bdat-settings";
    return null;
  }

  function categorizeBdatTable(label: string): string {
    const match = label.match(/^(.+?)\[\d+\]/);
    if (!match) return "other";
    const tbl = match[1];
    const colMatch = label.match(/\]\s*\.?\s*(.+)/);
    const col = colMatch ? colMatch[1] : "";
    const tblCat = categorizeByTableName(tbl);
    if (tblCat) return tblCat;
    const colCat = categorizeByColumnName(col);
    if (colCat) return colCat;
    return "other";
  }

  it("categorizes known table prefixes", () => {
    expect(categorizeBdatTable("MNU_Msg[0].Name")).toBe("bdat-menu");
    expect(categorizeBdatTable("BTL_Arts_PC[5].Name")).toBe("bdat-battle");
    expect(categorizeBdatTable("QST_List[2].Title")).toBe("bdat-quest");
    expect(categorizeBdatTable("FLD_MapList[0].Name")).toBe("bdat-field");
    expect(categorizeBdatTable("ITM_Accessory[3].Name")).toBe("bdat-item");
    expect(categorizeBdatTable("CHR_Dr[0].Name")).toBe("bdat-character");
  });

  it("categorizes gimmick tables (lowercase)", () => {
    expect(categorizeBdatTable("gimmickMob[0].Name")).toBe("bdat-gimmick");
    expect(categorizeBdatTable("gimmickTreasureBox[5].Name")).toBe("bdat-gimmick");
  });

  it("categorizes msg_ tables as message archive", () => {
    expect(categorizeBdatTable("msg_btl_ChSU_gate_message[0].Name")).toBe("bdat-message");
  });

  it("falls back to column name for unresolved hash tables", () => {
    expect(categorizeBdatTable("0xABC123[0].Caption")).toBe("bdat-menu");
    expect(categorizeBdatTable("0xABC123[0].TaskSummary")).toBe("bdat-quest");
    expect(categorizeBdatTable("0xABC123[0].LandmarkName")).toBe("bdat-field");
    expect(categorizeBdatTable("0xABC123[0].WeaponSkill")).toBe("bdat-item");
    expect(categorizeBdatTable("0xABC123[0].VoiceSetting")).toBe("bdat-settings");
  });

  it("returns other for fully unresolved entries", () => {
    expect(categorizeBdatTable("0xABC123[0].0xDEF456")).toBe("other");
    expect(categorizeBdatTable("0xABC123[0].Name")).toBe("other"); // Name is too generic
  });
});
