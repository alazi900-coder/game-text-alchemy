import React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export type FilterStatus = "all" | "translated" | "untranslated" | "problems" | "needs-improve" | "too-short" | "too-long" | "stuck-chars" | "mixed-lang" | "has-tags" | "damaged-tags" | "fuzzy" | "byte-overflow" | "has-newlines";

export type FilterTechnical = "all" | "only" | "exclude";

export interface ExtractedEntry {
  msbtFile: string;
  index: number;
  label: string;
  original: string;
  maxBytes: number;
}

export interface EditorState {
  entries: ExtractedEntry[];
  translations: Record<string, string>;
  protectedEntries?: Set<string>;
  glossary?: string;
  technicalBypass?: Set<string>;
  fuzzyScores?: Record<string, number>;
  isDemo?: boolean;
}

export interface ReviewIssue {
  key: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  original?: string;
  translation?: string;
}

export interface ReviewSummary {
  total: number;
  errors: number;
  warnings: number;
  checked: number;
}

export interface ReviewResults {
  issues: ReviewIssue[];
  summary: ReviewSummary;
}

export interface ShortSuggestion {
  key: string;
  original: string;
  current: string;
  suggested: string;
  currentBytes: number;
  suggestedBytes: number;
  maxBytes: number;
}

export interface ImproveResult {
  key: string;
  original: string;
  current: string;
  improved: string;
  reason: string;
  improvedBytes: number;
  maxBytes: number;
}

export interface FileCategory {
  id: string;
  label: string;
  emoji: string;
  icon?: string;
  color?: string;
}

export const AUTOSAVE_DELAY = 1500;
export const AI_BATCH_SIZE = 5;
export const PAGE_SIZE = 50;
export const INPUT_DEBOUNCE = 300;

// Tag type config for color-coded display
export const TAG_TYPES: Record<string, { label: string; color: string; tooltip: string }> = {
  '\uFFF9': { label: '\u2699', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', tooltip: '\u0631\u0645\u0632 \u062A\u062D\u0643\u0645 (\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A\u060C \u0627\u0646\u062A\u0638\u0627\u0631\u060C \u0633\u0631\u0639\u0629 \u0646\u0635)' },
  '\uFFFA': { label: '\uD83C\uDFA8', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', tooltip: '\u0631\u0645\u0632 \u062A\u0646\u0633\u064A\u0642 (\u0644\u0648\u0646\u060C \u062D\u062C\u0645 \u062E\u0637\u060C \u0631\u0648\u0628\u064A)' },
  '\uFFFB': { label: '\uD83D\uDCCC', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', tooltip: '\u0645\u062A\u063A\u064A\u0631 (\u0627\u0633\u0645 \u0627\u0644\u0644\u0627\u0639\u0628\u060C \u0639\u062F\u062F\u060C \u0627\u0633\u0645 \u0639\u0646\u0635\u0631)' },
};
export const TAG_FALLBACK = { label: '\u2026', color: 'bg-muted text-muted-foreground', tooltip: '\u0631\u0645\u0632 \u062A\u0642\u0646\u064A \u062E\u0627\u0635 \u0628\u0645\u062D\u0631\u0643 \u0627\u0644\u0644\u0639\u0628\u0629' };

export const FILE_CATEGORIES: FileCategory[] = [
  { id: "main-menu", label: "\u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629", emoji: "\uD83C\uDFE0", icon: "Home", color: "text-emerald-400" },
  { id: "settings", label: "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A", emoji: "\u2699\uFE0F", icon: "Settings", color: "text-slate-400" },
  { id: "hud", label: "\u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0644\u0639\u0628 (HUD)", emoji: "\uD83D\uDDA5\uFE0F", icon: "MonitorSmartphone", color: "text-sky-400" },
  { id: "pause-menu", label: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0625\u064A\u0642\u0627\u0641", emoji: "\u23F8\uFE0F", icon: "Pause", color: "text-orange-400" },
  { id: "swords", label: "\u0627\u0644\u0633\u064A\u0648\u0641", emoji: "\u2694\uFE0F", icon: "Sword", color: "text-red-400" },
  { id: "bows", label: "\u0627\u0644\u0623\u0642\u0648\u0627\u0633", emoji: "\uD83C\uDFF9", icon: "Target", color: "text-lime-400" },
  { id: "shields", label: "\u0627\u0644\u062F\u0631\u0648\u0639", emoji: "\uD83D\uDEE1\uFE0F", icon: "ShieldCheck", color: "text-blue-400" },
  { id: "armor", label: "\u0627\u0644\u0645\u0644\u0627\u0628\u0633 \u0648\u0627\u0644\u062F\u0631\u0648\u0639", emoji: "\uD83D\uDC55", icon: "Shirt", color: "text-violet-400" },
  { id: "materials", label: "\u0627\u0644\u0645\u0648\u0627\u062F \u0648\u0627\u0644\u0645\u0648\u0627\u0631\u062F", emoji: "\uD83E\uDDEA", icon: "FlaskConical", color: "text-teal-400" },
  { id: "food", label: "\u0627\u0644\u0637\u0639\u0627\u0645 \u0648\u0627\u0644\u0637\u0628\u062E", emoji: "\uD83C\uDF56", icon: "Utensils", color: "text-amber-400" },
  { id: "key-items", label: "\u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0647\u0645\u0629", emoji: "\uD83D\uDD11", icon: "Key", color: "text-yellow-400" },
  { id: "story", label: "\u062D\u0648\u0627\u0631\u0627\u062A \u0627\u0644\u0642\u0635\u0629", emoji: "\uD83D\uDCD6", icon: "BookOpen", color: "text-violet-400" },
  { id: "challenge", label: "\u0627\u0644\u0645\u0647\u0627\u0645 \u0648\u0627\u0644\u062A\u062D\u062F\u064A\u0627\u062A", emoji: "\uD83D\uDCDC", icon: "ScrollText", color: "text-orange-400" },
  { id: "map", label: "\u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0648\u0627\u0644\u062E\u0631\u0627\u0626\u0637", emoji: "\uD83D\uDDFA\uFE0F", icon: "Map", color: "text-emerald-400" },
  { id: "tips", label: "\u0627\u0644\u0646\u0635\u0627\u0626\u062D \u0648\u0627\u0644\u062A\u0639\u0644\u064A\u0645\u0627\u062A", emoji: "\uD83D\uDCA1", icon: "Lightbulb", color: "text-yellow-400" },
  { id: "character", label: "\u0627\u0644\u0634\u062E\u0635\u064A\u0627\u062A \u0648\u0627\u0644\u0623\u0639\u062F\u0627\u0621", emoji: "\uD83C\uDFAD", icon: "Drama", color: "text-rose-400" },
  { id: "npc", label: "\u062D\u0648\u0627\u0631\u0627\u062A \u0627\u0644\u0634\u062E\u0635\u064A\u0627\u062A", emoji: "\uD83D\uDCAC", icon: "MessageCircle", color: "text-cyan-400" },
];

/** @deprecated BDAT removed — stub for compatibility */
export const BDAT_CATEGORIES: FileCategory[] = [];

/** @deprecated BDAT removed — stub returns "other" */
export function categorizeBdatTable(_label: string, _sourceFile?: string, _original?: string): string {
  return "other";
}

// ========== Animal Crossing: New Horizons Categories ==========
export const ACNH_CATEGORIES: FileCategory[] = [
  { id: "acnh-furniture", label: "الأثاث والديكور", emoji: "🪑", icon: "Home", color: "text-amber-400" },
  { id: "acnh-clothing", label: "الملابس والإكسسوارات", emoji: "👗", icon: "Shirt", color: "text-violet-400" },
  { id: "acnh-tools", label: "الأدوات", emoji: "🔨", icon: "Wrench", color: "text-slate-400" },
  { id: "acnh-insects", label: "الحشرات", emoji: "🦋", icon: "Target", color: "text-lime-400" },
  { id: "acnh-fish", label: "الأسماك", emoji: "🐟", icon: "Utensils", color: "text-sky-400" },
  { id: "acnh-sea", label: "مخلوقات البحر", emoji: "🦑", icon: "FlaskConical", color: "text-cyan-400" },
  { id: "acnh-shells", label: "الأصداف", emoji: "🐚", icon: "Gem", color: "text-pink-400" },
  { id: "acnh-fossils", label: "الحفريات", emoji: "🦴", icon: "BookOpen", color: "text-orange-400" },
  { id: "acnh-plants", label: "النباتات والزهور", emoji: "🌿", icon: "FlaskConical", color: "text-emerald-400" },
  { id: "acnh-crafting", label: "الصناعة والتخصيص", emoji: "🛠️", icon: "Wrench", color: "text-yellow-400" },
  { id: "acnh-art", label: "اللوحات والصور", emoji: "🖼️", icon: "Drama", color: "text-rose-400" },
  { id: "acnh-music", label: "الموسيقى", emoji: "🎵", icon: "Clapperboard", color: "text-violet-400" },
  { id: "acnh-fences", label: "الأسوار", emoji: "🏡", icon: "ShieldCheck", color: "text-teal-400" },
  { id: "acnh-wallpaper", label: "ورق الجدران والأرضيات", emoji: "🎨", icon: "MonitorSmartphone", color: "text-indigo-400" },
  { id: "acnh-villagers", label: "القرويون", emoji: "🏘️", icon: "Users", color: "text-rose-400" },
  { id: "acnh-special-npcs", label: "الشخصيات الخاصة", emoji: "⭐", icon: "Sparkles", color: "text-yellow-400" },
  { id: "acnh-events", label: "الأحداث والمناسبات", emoji: "🎉", icon: "Clapperboard", color: "text-red-400" },
  { id: "acnh-species", label: "الأنواع والسلالات", emoji: "🐾", icon: "Drama", color: "text-purple-400" },
  { id: "acnh-misc", label: "متنوع", emoji: "📦", icon: "Backpack", color: "text-muted-foreground" },
  { id: "acnh-system", label: "النظام والقوائم", emoji: "⚙️", icon: "Settings", color: "text-slate-400" },
  { id: "acnh-dialogue", label: "الحوارات", emoji: "💬", icon: "MessageCircle", color: "text-cyan-400" },
  { id: "acnh-mail", label: "الرسائل والبريد", emoji: "✉️", icon: "MessageSquare", color: "text-blue-400" },
];

/**
 * Categorize ACNH files — handles both CSV category names and MSBT filenames
 */
export function categorizeACNHFile(filePath: string): string {
  const lower = filePath.toLowerCase();

  // CSV category names (from loadGameEnglishTexts)
  const csvMap: Record<string, string> = {
    "furniture": "acnh-furniture",
    "tools": "acnh-tools",
    "insects": "acnh-insects",
    "fish": "acnh-fish",
    "sea creatures": "acnh-sea",
    "shells": "acnh-shells",
    "fossils": "acnh-fossils",
    "plants": "acnh-plants",
    "crafting": "acnh-crafting",
    "miscellaneous": "acnh-misc",
    "music": "acnh-music",
    "fences": "acnh-fences",
    "villagers": "acnh-villagers",
    "special npcs": "acnh-special-npcs",
    "events": "acnh-events",
    "species": "acnh-species",
    "clothing": "acnh-clothing",
    "art": "acnh-art",
    "wallpaper": "acnh-wallpaper",
  };
  if (csvMap[lower]) return csvMap[lower];

  // MSBT filename patterns
  if (/STR_ItemName_00_Ftr|Furniture|FtrMsg/i.test(filePath)) return "acnh-furniture";
  if (/STR_ItemName_20_Tool|ToolMsg/i.test(filePath)) return "acnh-tools";
  if (/STR_ItemName_30_Insect|InsectMsg/i.test(filePath)) return "acnh-insects";
  if (/STR_ItemName_31_Fish|FishMsg/i.test(filePath)) return "acnh-fish";
  if (/STR_ItemName_32_Dive|DiveFish|SeaMsg/i.test(filePath)) return "acnh-sea";
  if (/STR_ItemName_33_Shell|ShellMsg/i.test(filePath)) return "acnh-shells";
  if (/STR_ItemName_34_Fossil|FossilMsg/i.test(filePath)) return "acnh-fossils";
  if (/STR_ItemName_40_Plant|PlantMsg|FlowerMsg/i.test(filePath)) return "acnh-plants";
  if (/STR_ItemName_70_Craft|CraftMsg|DIY/i.test(filePath)) return "acnh-crafting";
  if (/STR_ItemName_82_Music|MusicMsg/i.test(filePath)) return "acnh-music";
  if (/STR_ItemName_83_Fence|FenceMsg/i.test(filePath)) return "acnh-fences";
  if (/STR_NNpcName|NNpc|TalkNNpc/i.test(filePath)) return "acnh-villagers";
  if (/STR_SNpcName|SNpc|TalkSNpc/i.test(filePath)) return "acnh-special-npcs";
  if (/STR_EventName|EventMsg|EventFlow/i.test(filePath)) return "acnh-events";
  if (/STR_Race/i.test(filePath)) return "acnh-species";
  if (/STR_ItemName_01_Cap|STR_ItemName_02_Tops|STR_ItemName_03_Bottoms|STR_ItemName_04_Dress|STR_ItemName_05_Socks|STR_ItemName_06_Shoes|STR_ItemName_07_Bag|STR_ItemName_08_Acc|Cloth/i.test(filePath)) return "acnh-clothing";
  if (/STR_ItemName_10_Rug|STR_ItemName_11_Wall|STR_ItemName_12_Floor|Wallpaper|Floor|Rug/i.test(filePath)) return "acnh-wallpaper";
  if (/RecipeMsg|Recipe/i.test(filePath)) return "acnh-recipes";
  if (/SYS_|System|Config|Setting|Option/i.test(filePath)) return "acnh-system";
  if (/Dialog|Talk|Chat/i.test(filePath)) return "acnh-dialogue";
  if (/Mail|Letter/i.test(filePath)) return "acnh-mail";
  if (/STR_ItemName_80_Etc/i.test(filePath)) return "acnh-misc";

  return "other";
}

// Check if text contains technical tag markers
export function hasTechnicalTags(text: string): boolean {
  return /[\uFFF9\uFFFA\uFFFB\uFFFC\uE000-\uE0FF]/.test(text)
    || /\[\s*\w+\s*:[^\]]*\]/.test(text)
    || /\[\/\w+:[^\]]*\]/.test(text)
    || /\[\s*\w+\s*=\s*\w[^\]]*\]/.test(text)
    || /\{\s*\w+\s*:\s*\w[^}]*\}/.test(text);
}

// Re-export from dedicated module
export { restoreTagsLocally, previewTagRestore } from "@/lib/tag-restoration";

// Sanitize original text: replace binary tag markers with color-coded, tooltipped badges
export function displayOriginal(text: string): React.ReactNode {
  const regex = /([\uFFF9\uFFFA\uFFFB\uFFFC\uE000-\uE0FF\u0000-\u0008\u000E-\u001F]+|\[\/?\w+:[^\]]*\])/g;
  const parts = text.split(regex);
  if (parts.length === 1 && !regex.test(text)) return text;
  const elements: React.ReactNode[] = [];
  let keyIdx = 0;
  let mlCounter = 0;
  for (const part of parts) {
    if (!part) continue;
    const firstCode = part.charCodeAt(0);

    // [Tag:Value] format tags
    if (/^\[\/?\w+:[^\]]*\]$/.test(part)) {
      mlCounter++;
      const isEnd = part.startsWith('[/');
      const inner = isEnd ? part.slice(2, -1) : part.slice(1, -1);
      const tagType = inner.split(':')[0];
      const tagValue = inner.split(':').slice(1).join(':').trim();
      const isMsbt = tagType === 'MSBT';
      const badgeColor = isEnd
        ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
        : isMsbt
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
          : 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      const badgeLabel = isEnd
        ? `/${tagValue || tagType}`
        : isMsbt
          ? tagValue || tagType
          : `[${tagType}]${mlCounter}`;
      elements.push(
        <Tooltip key={keyIdx++}>
          <TooltipTrigger asChild>
            <span className={`inline-block px-1 rounded border text-xs cursor-help mx-0.5 ${badgeColor}`}>
              {badgeLabel}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            <div className="font-mono text-[10px] opacity-70">{part}</div>
            <div>{isEnd ? '\u0646\u0647\u0627\u064A\u0629 \u0648\u0633\u0645 \u2014 \u0644\u0627 \u062A\u062D\u0630\u0641\u0647' : '\u0648\u0633\u0645 \u0645\u062D\u0631\u0643 \u0627\u0644\u0644\u0639\u0628\u0629 \u2014 \u0644\u0627 \u062A\u062D\u0630\u0641\u0647 \u0623\u0648 \u062A\u0639\u062F\u0651\u0644\u0647'}</div>
          </TooltipContent>
        </Tooltip>
      );
      continue;
    }

    // PUA markers (E000-E0FF)
    if (firstCode >= 0xE000 && firstCode <= 0xE0FF) {
      for (let ci = 0; ci < part.length; ci++) {
        const code = part.charCodeAt(ci);
        if (code >= 0xE000 && code <= 0xE0FF) {
          const tagNum = code - 0xE000 + 1;
          elements.push(
            <Tooltip key={keyIdx++}>
              <TooltipTrigger asChild>
                <span className="inline-block px-1 rounded border text-xs cursor-help mx-0.5 bg-blue-500/20 text-blue-400 border-blue-500/30">
                  \uD83C\uDFF7{tagNum}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                \u0631\u0645\u0632 \u062A\u062D\u0643\u0645 #{tagNum} \u2014 \u0623\u064A\u0642\u0648\u0646\u0629 \u0632\u0631 \u0623\u0648 \u062A\u0646\u0633\u064A\u0642 (\u0644\u0627 \u062A\u062D\u0630\u0641\u0647)
              </TooltipContent>
            </Tooltip>
          );
        }
      }
      continue;
    }
    // Legacy FFF9-FFFC markers or other control chars
    const tagTypeInfo = TAG_TYPES[part[0]] || (part.match(/[\uFFF9\uFFFA\uFFFB\uFFFC\u0000-\u0008\u000E-\u001F]/) ? TAG_FALLBACK : null);
    if (tagTypeInfo) {
      elements.push(
        <Tooltip key={keyIdx++}>
          <TooltipTrigger asChild>
            <span className={`inline-block px-1 rounded border text-xs cursor-help mx-0.5 ${tagTypeInfo.color}`}>
              {tagTypeInfo.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {tagTypeInfo.tooltip}
          </TooltipContent>
        </Tooltip>
      );
      continue;
    }
    elements.push(<React.Fragment key={keyIdx++}>{part}</React.Fragment>);
  }
  return elements;
}

export function categorizeFile(filePath: string): string {
  if (/LayoutMsg\/(Title|Boot|Save|Load|GameOver|Opening|Ending)/i.test(filePath)) return "main-menu";
  if (/LayoutMsg\/(Option|Config|Setting|System|Language|Control|Camera|Sound)/i.test(filePath)) return "settings";
  if (/LayoutMsg\/(Pause|Menu|Pouch|Inventory|Equipment|Status)/i.test(filePath)) return "pause-menu";
  if (/LayoutMsg\//i.test(filePath)) return "hud";
  if (/ActorMsg\/(Weapon_Sword|Weapon_Lsword|Weapon_SmallSword)/i.test(filePath)) return "swords";
  if (/ActorMsg\/Weapon_Bow/i.test(filePath)) return "bows";
  if (/ActorMsg\/Weapon_Shield/i.test(filePath)) return "shields";
  if (/ActorMsg\/Armor/i.test(filePath)) return "armor";
  if (/ActorMsg\/Item_Material/i.test(filePath)) return "materials";
  if (/ActorMsg\/(Item_Cook|Item_Fruit|Item_Mushroom|Item_Fish|Item_Meat|Item_Plant)/i.test(filePath)) return "food";
  if (/ActorMsg\/(PouchContent|Item_Key|Item_Ore|Item_Enemy|Item_Insect|Item_)/i.test(filePath)) return "key-items";
  if (/EventFlowMsg\/(Npc|Demo_Npc)/i.test(filePath)) return "npc";
  if (/EventFlowMsg\//i.test(filePath)) return "story";
  if (/ChallengeMsg\//i.test(filePath)) return "challenge";
  if (/LocationMsg\//i.test(filePath)) return "map";
  if (/StaticMsg\/(Tips|GuideKeyIcon)\.msbt/i.test(filePath)) return "tips";
  if (/ActorMsg\/Enemy/i.test(filePath)) return "character";
  if (/ActorMsg\//i.test(filePath)) return "character";
  return "other";
}

// Re-export from canonical source to avoid duplication
export { isArabicChar, hasArabicChars, reverseBidi as unReverseBidi } from "@/lib/arabic-processing";

export function isTechnicalText(text: string): boolean {
  const t = text.trim();
  if (/^[0-9A-Fa-f\-\._:\/]+$/.test(t)) return true;
  if (/\[[^\]]*\]/.test(text) && text.length < 50) return true;
  if (/<[^>]+>/.test(text)) return true;
  if (/[\\/][\w\-]+[\\/]/i.test(text)) return true;
  if (text.length < 10 && /[{}()\[\]<>|&%$#@!]/.test(text)) return true;
  if (/^[a-z]+([A-Z][a-z]*)+$|^[a-z]+(_[a-z]+)+$/.test(t)) return true;
  if (/^[a-zA-Z0-9]{1,6}$/.test(t) && !/^[A-Z][a-z]{2,}$/.test(t)) return true;
  const strippedML = text.replace(/\[\s*\w+\s*:[^\]]*\]/g, '').trim();
  if (strippedML.length === 0 && /\[\s*\w+\s*:[^\]]*\]/.test(text)) return true;
  return false;
}

export function entryKey(entry: ExtractedEntry): string {
  return `${entry.msbtFile}:${entry.index}`;
}
