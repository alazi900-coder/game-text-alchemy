/**
 * Central MSBT key normalizer.
 * Resolves mismatches between scoped keys (current session) and unscoped keys (legacy/imported).
 *
 * Scoped key example:   msbt:bundle__accessories__entry_0.msbt:SomeLabel:42
 * Unscoped key example: msbt:entry_0.msbt:SomeLabel:42
 */

export interface NormalizeResult {
  normalized: Record<string, string>;
  matched: number;
  remapped: number;
  ambiguous: number;
  dropped: number;
}

/** Extract the short MSBT filename from any key format */
export function extractShortMsbtName(key: string): string | null {
  if (!key.startsWith("msbt:")) return null;
  const payload = key.slice(5); // remove "msbt:"
  // First extract the msbt file portion (before the label:index part)
  const msbtMatch = payload.match(/^(.+?\.msbt)(?::|$)/i);
  const msbtPart = msbtMatch?.[1] || payload.split(":")[0];
  // Strip scoped prefix: "bundle__accessories__entry_0.msbt" → "entry_0.msbt"
  const lastDunder = msbtPart.lastIndexOf("__");
  if (lastDunder !== -1) {
    return msbtPart.slice(lastDunder + 2);
  }
  return msbtPart;
}

/** Extract the index (last numeric segment) from an MSBT key */
export function extractMsbtIndex(key: string): number | null {
  const lastColon = key.lastIndexOf(":");
  if (lastColon === -1) return null;
  const part = key.slice(lastColon + 1);
  return /^\d+$/.test(part) ? Number(part) : null;
}

/** Extract the label from an MSBT key (second-to-last segment) */
export function extractMsbtLabel(key: string): string | null {
  const parts = key.split(":");
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

/** Count unique MSBT file names from entry keys */
export function countUniqueMsbtFiles(entries: { msbtFile: string }[]): number {
  const files = new Set<string>();
  for (const e of entries) {
    const short = extractShortMsbtName(e.msbtFile);
    if (short) files.add(short);
    else files.add(e.msbtFile);
  }
  return files.size;
}

/**
 * Build lookup maps from session entries for multi-stage matching.
 */
function buildSessionMaps(validKeys: Set<string>) {
  // shortName → Map<index, sessionKey>
  const byShortNameAndIndex = new Map<string, Map<number, string>>();
  // shortName+label+index → sessionKey
  const byShortNameLabelIndex = new Map<string, string>();
  // Full scoped name (as extracted) → Map<index, sessionKey>
  const byFullNameAndIndex = new Map<string, Map<number, string>>();

  for (const sessionKey of validKeys) {
    if (!sessionKey.startsWith("msbt:")) continue;
    const shortName = extractShortMsbtName(sessionKey);
    const index = extractMsbtIndex(sessionKey);
    const label = extractMsbtLabel(sessionKey);
    if (shortName == null || index == null) continue;

    // Short name + index
    if (!byShortNameAndIndex.has(shortName)) byShortNameAndIndex.set(shortName, new Map());
    const indexMap = byShortNameAndIndex.get(shortName)!;
    if (!indexMap.has(index)) indexMap.set(index, sessionKey);

    // Short name + label + index
    if (label) {
      const compound = `${shortName}:${label}:${index}`;
      if (!byShortNameLabelIndex.has(compound)) byShortNameLabelIndex.set(compound, sessionKey);
    }

    // Full name (the msbtFile part before the label/index)
    const payload = sessionKey.slice(5);
    const msbtMatch = payload.match(/^(.+?\.msbt)(?::|$)/i);
    const fullName = msbtMatch?.[1] || payload.split(":")[0];
    if (!byFullNameAndIndex.has(fullName)) byFullNameAndIndex.set(fullName, new Map());
    const fullMap = byFullNameAndIndex.get(fullName)!;
    if (!fullMap.has(index)) fullMap.set(index, sessionKey);
  }

  return { byShortNameAndIndex, byShortNameLabelIndex, byFullNameAndIndex };
}

/** Parse msbt key variants (scoped/unscoped, with or without msbt: prefix). */
function parseMsbtLikeKey(rawKey: string): { fullName: string; shortName: string; label: string | null; index: number } | null {
  const payload = rawKey.startsWith("msbt:") ? rawKey.slice(5) : rawKey;
  const msbtMatch = payload.match(/^(.+?\.msbt)(?::|$)/i);
  if (!msbtMatch?.[1]) return null;

  const fullName = msbtMatch[1];
  const tail = payload.slice(fullName.length);
  if (!tail.startsWith(":")) return null;

  const parts = tail.slice(1).split(":").filter(Boolean);
  if (parts.length === 0) return null;

  const indexPart = parts[parts.length - 1];
  if (!/^\d+$/.test(indexPart)) return null;

  const index = Number(indexPart);
  const label = parts.length >= 2 ? parts[parts.length - 2] : null;
  const shortName = extractShortMsbtName(`msbt:${fullName}`) || fullName;

  return { fullName, shortName, label, index };
}

function isLikelyMsbtKey(rawKey: string): boolean {
  return rawKey.startsWith("msbt:") || /\.msbt(?::|$)/i.test(rawKey);
}

function mapMsbtKeyToSession(
  rawKey: string,
  maps: ReturnType<typeof buildSessionMaps>,
): { mappedKey?: string; isAmbiguous: boolean } {
  const parsed = parseMsbtLikeKey(rawKey);
  if (!parsed) return { isAmbiguous: false };

  let mappedKey: string | undefined;

  // Stage 2: Full name + index
  mappedKey = maps.byFullNameAndIndex.get(parsed.fullName)?.get(parsed.index);

  // Stage 3: Short name + label + index
  if (!mappedKey && parsed.label) {
    mappedKey = maps.byShortNameLabelIndex.get(`${parsed.shortName}:${parsed.label}:${parsed.index}`);
  }

  // Stage 4: Short name + index (unique scope only)
  if (!mappedKey) {
    const indexMap = maps.byShortNameAndIndex.get(parsed.shortName);
    const candidate = indexMap?.get(parsed.index);

    if (candidate) {
      let scopeCount = 0;
      for (const fullKey of maps.byFullNameAndIndex.keys()) {
        const short = extractShortMsbtName(`msbt:${fullKey}`);
        if (short === parsed.shortName) scopeCount++;
      }

      if (scopeCount <= 1) {
        mappedKey = candidate;
      } else {
        return { isAmbiguous: true };
      }
    }
  }

  return { mappedKey, isAmbiguous: false };
}

/**
 * Normalize translations to match current session keys.
 * Multi-stage fallback:
 * 1. Exact match
 * 2. Full name + index match
 * 3. Short name + label + index
 * 4. Short name + index (unique only)
 */
export function normalizeMsbtTranslations(
  translations: Record<string, string>,
  validKeys: Set<string>,
): NormalizeResult {
  // Defensive: if translations is not a proper object, return empty
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
    console.warn('[NORMALIZER] translations is not an object:', typeof translations);
    return { normalized: {}, matched: 0, remapped: 0, ambiguous: 0, dropped: 0 };
  }

  const normalized: Record<string, string> = {};
  let matched = 0, remapped = 0, ambiguous = 0, dropped = 0;
  const maps = buildSessionMaps(validKeys);

  for (const [rawKey, rawValue] of Object.entries(translations)) {
    const trimmed = rawValue?.trim();
    if (!trimmed) continue;

    // Stage 1: Exact match
    if (validKeys.has(rawKey)) {
      normalized[rawKey] = trimmed;
      matched++;
      continue;
    }

    // MSBT-like keys can be scoped, unscoped, or legacy without "msbt:" prefix.
    if (isLikelyMsbtKey(rawKey)) {
      const { mappedKey, isAmbiguous } = mapMsbtKeyToSession(rawKey, maps);

      if (mappedKey && !normalized[mappedKey]) {
        normalized[mappedKey] = trimmed;
        remapped++;
      } else if (isAmbiguous) {
        ambiguous++;
      } else {
        dropped++;
        // Preserve unmatched key for cross-session storage/import; it won't be used in current build.
        normalized[rawKey] = trimmed;
      }
      continue;
    }

    // Non-MSBT key (bdat, etc.) - keep as-is for other handlers
    normalized[rawKey] = trimmed;
    matched++;
  }

  return { normalized, matched, remapped, ambiguous, dropped };
}

/**
 * Count how many translations would actually be included in the build.
 * Single source of truth for "translated count that matters".
 */
export function countBuildableTranslations(
  translations: Record<string, string>,
  validKeys: Set<string>,
): number {
  const { normalized } = normalizeMsbtTranslations(translations, validKeys);
  return Object.keys(normalized).filter(k => validKeys.has(k)).length;
}
