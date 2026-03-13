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
  // Match the .msbt filename which may be prefixed with scoped path using "__"
  const match = payload.match(/(?:^|__)([^_][^:]*?\.msbt)(?::|$)/i);
  if (match?.[1]) return match[1];
  // Fallback: first segment before ":"
  const firstColon = payload.indexOf(":");
  return firstColon === -1 ? payload : payload.slice(0, firstColon);
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

    // Only try remapping for msbt: keys
    if (!rawKey.startsWith("msbt:")) {
      // Non-MSBT key (bdat, etc.) - keep as-is for other handlers
      normalized[rawKey] = trimmed;
      matched++;
      continue;
    }

    const shortName = extractShortMsbtName(rawKey);
    const index = extractMsbtIndex(rawKey);
    const label = extractMsbtLabel(rawKey);

    if (shortName == null || index == null) {
      dropped++;
      continue;
    }

    let mappedKey: string | undefined;

    // Stage 2: Full name + index (handles exact scoped name from same session)
    const payload = rawKey.slice(5);
    const msbtMatch = payload.match(/^(.+?\.msbt)(?::|$)/i);
    const fullName = msbtMatch?.[1] || payload.split(":")[0];
    mappedKey = maps.byFullNameAndIndex.get(fullName)?.get(index);

    // Stage 3: Short name + label + index
    if (!mappedKey && label) {
      const compound = `${shortName}:${label}:${index}`;
      mappedKey = maps.byShortNameLabelIndex.get(compound);
    }

    // Stage 4: Short name + index
    if (!mappedKey) {
      const indexMap = maps.byShortNameAndIndex.get(shortName);
      if (indexMap) {
        const candidate = indexMap.get(index);
        if (candidate) {
          // Check for ambiguity: multiple scoped files share same short name
          // Count how many full names map to this short name
          let scopeCount = 0;
          for (const fullKey of maps.byFullNameAndIndex.keys()) {
            const fShort = extractShortMsbtName(`msbt:${fullKey}`);
            if (fShort === shortName) scopeCount++;
          }
          if (scopeCount <= 1) {
            mappedKey = candidate;
          } else {
            // Ambiguous - multiple scoped files have same short name
            ambiguous++;
            continue;
          }
        }
      }
    }

    if (mappedKey && !normalized[mappedKey]) {
      normalized[mappedKey] = trimmed;
      remapped++;
    } else if (!mappedKey) {
      dropped++;
    }
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
