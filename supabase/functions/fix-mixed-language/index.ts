import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Tag Protection ---
const TAG_PATTERNS: RegExp[] = [
  /\[\s*\w+:\w[^\]]*\][^[]*?\[\/\s*\w+:\w[^\]]*\]/g, // Paired tags
  /\[\s*M[A-Z]*ID_[^\]]+\]/g,
  /[\uE000-\uE0FF]+/g,
  /\$\w+\([^)]*\)/g,
  /\$\w+/g,
  /\[\s*\w+\s*:[^\]]*?\s*\]/g,
  /\[\s*\w+\s*=\s*\w[^\]]*\]/g,
  /\{\s*\w+\s*:\s*\w[^}]*\}/g,
  /\{[\w]+\}/g,
  /%[sd]/g,
  /[\uFFF9-\uFFFC]/g,
  /<[\w\/][^>]*>/g,
];

function shieldTags(text: string): { shielded: string; slots: string[] } {
  const slots: string[] = [];
  const matches: { start: number; end: number; original: string }[] = [];
  for (const pattern of TAG_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const s = m.index, e = s + m[0].length;
      if (!matches.some(x => s < x.end && e > x.start)) matches.push({ start: s, end: e, original: m[0] });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  if (matches.length === 0) return { shielded: text, slots: [] };
  let result = '', lastEnd = 0;
  for (const m of matches) {
    result += text.slice(lastEnd, m.start);
    result += `⟪T${slots.length}⟫`;
    slots.push(m.original);
    lastEnd = m.end;
  }
  result += text.slice(lastEnd);
  return { shielded: result, slots };
}

function unshieldTags(text: string, slots: string[]): string {
  if (slots.length === 0) return text;
  let result = text;
  for (let i = slots.length - 1; i >= 0; i--) {
    const variants = [
      `⟪T${i}⟫`, `⟪ T${i} ⟫`, `⟪T${i} ⟫`, `⟪ T${i}⟫`,
      `[T${i}]`, `(T${i})`, `«T${i}»`, `《T${i}》`, `〈T${i}〉`,
      `T${i}`,
    ];
    for (const v of variants) {
      if (result.includes(v)) { result = result.replace(v, slots[i]); break; }
    }
  }
  result = result.replace(/⟪T\d+⟫/g, '');
  // Post-validation: re-insert lost tags
  for (let i = 0; i < slots.length; i++) {
    if (!result.includes(slots[i])) {
      result = result.trimEnd() + ' ' + slots[i];
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entries, glossary } = await req.json() as {
      entries: { key: string; original: string; translation: string }[];
      glossary?: string;
    };

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ translations: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Shield tags before sending to AI
    const shieldedEntries = entries.map(e => {
      const { shielded: shieldedOrig } = shieldTags(e.original);
      const { shielded: shieldedTrans, slots } = shieldTags(e.translation);
      return { ...e, shieldedOrig, shieldedTrans, slots };
    });

    const textsBlock = shieldedEntries.map((e, i) => 
      `[${i}]\nOriginal: ${e.shieldedOrig}\nCurrent translation (mixed): ${e.shieldedTrans}`
    ).join('\n\n');

    let glossarySection = '';
    if (glossary?.trim()) {
      glossarySection = `\n\nUse this glossary for consistent terminology:\n${glossary}\n`;
    }

    const prompt = `You are a professional Arabic game translator for The Legend of Zelda series.

The following translations contain a mix of Arabic and English text. Your job is to translate the remaining English words into Arabic while keeping the sentence natural and coherent.

CRITICAL RULES:
- Translate ALL English words to Arabic, except for:
  - Proper nouns that are commonly kept in English in Arabic gaming (Link, Zelda, Ganon, Hyrule, etc.)
  - Technical gaming abbreviations: HP, MP, ATK, DEF, NPC, XP, DLC, HUD, FPS
  - Controller button names: A, B, X, Y, L, R, ZL, ZR
- ⚠️ Placeholders like ⟪T0⟫, ⟪T1⟫ are protected technical elements — keep them EXACTLY as-is, do NOT modify, translate, or remove them
- Keep the translation length close to the original
- Maintain the existing Arabic text structure and style
- Return ONLY a JSON array of the fixed translations in the same order. No explanations.${glossarySection}

Entries:
${textsBlock}`;

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) throw new Error('Missing LOVABLE_API_KEY');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a game text translator. Fix mixed Arabic/English translations by translating remaining English words. Output only valid JSON arrays. Never modify ⟪T0⟫ placeholders.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'تم تجاوز حد الطلبات، حاول لاحقاً' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'يرجى إضافة رصيد لاستخدام الذكاء الاصطناعي' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const err = await response.text();
      console.error('AI gateway error:', err);
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Failed to parse AI response');

    const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, ' ');
    const translations: string[] = JSON.parse(sanitized);

    const result: Record<string, string> = {};
    for (let i = 0; i < Math.min(shieldedEntries.length, translations.length); i++) {
      if (translations[i]?.trim()) {
        // Unshield tags in AI output
        result[shieldedEntries[i].key] = unshieldTags(translations[i], shieldedEntries[i].slots);
      }
    }

    return new Response(JSON.stringify({ translations: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'خطأ غير متوقع' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
