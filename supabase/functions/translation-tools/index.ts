import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// --- Tag Protection ---
const TAG_PATTERNS: RegExp[] = [
  /\[\s*MID_[^\]]+\]/g, /[\uE000-\uE0FF]+/g, /\$\w+\([^)]*\)/g, /\$\w+/g,
  /\[\s*\w+\s*:[^\]]*?\s*\]/g, /\[\s*\w+\s*=\s*\w[^\]]*\]/g, /\{[\w]+\}/g,
  /%[sd]/g, /[\uFFF9-\uFFFC]/g, /<[\w\/][^>]*>/g,
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
  let result = text;
  for (let i = slots.length - 1; i >= 0; i--) {
    const variants = [`⟪T${i}⟫`, `⟪ T${i} ⟫`, `[T${i}]`, `(T${i})`, `T${i}`, `«T${i}»`, `《T${i}》`];
    for (const v of variants) {
      if (result.includes(v)) { result = result.replace(v, slots[i]); break; }
    }
  }
  result = result.replace(/⟪T\d+⟫/g, '');
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, style, entries, glossary } = body;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let systemPrompt = '';
    let userPrompt = '';

    if (style === 'back-translate') {
      if (!text?.trim()) {
        return new Response(JSON.stringify({ error: 'No text provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      systemPrompt = `You are a professional Arabic-to-English translator for video game localization.
Translate the Arabic text back to English as accurately as possible.
- Preserve the original meaning and tone
- Keep technical tags like [ML:...] and {variables} unchanged
- Keep game terms in their English form
- Return ONLY the English translation, no explanations`;
      userPrompt = `Translate this Arabic text to English:\n\n${text}`;

    } else if (style === 'ai-fix') {
      const { original, translation: trans, issues } = body;
      if (!original || !trans) {
        return new Response(JSON.stringify({ error: 'Missing original or translation' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { shielded: shieldedOrig } = shieldTags(original);
      const { shielded: shieldedTrans, slots: transSlots } = shieldTags(trans);
      // Store slots for unshielding after AI response
      (body as any)._transSlots = transSlots;
      systemPrompt = `You are a professional Arabic video game localization expert.
Fix the Arabic translation to resolve ALL the listed issues while preserving the meaning.
Rules:
- ⚠️ Placeholders like ⟪T0⟫, ⟪T1⟫ are protected technical elements — keep them EXACTLY as-is
- Return ONLY the fixed Arabic translation, nothing else
- Do NOT change parts that have no issues`;
      userPrompt = `English original: ${shieldedOrig}\n\nCurrent Arabic translation: ${shieldedTrans}\n\nDetected issues:\n${issues}\n\nProvide the fixed Arabic translation:`;

    } else if (style === 'context-check') {
      // Contextual check: verify translation makes sense in game context
      if (!entries || !Array.isArray(entries)) {
        return new Response(JSON.stringify({ error: 'Missing entries array' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const glossaryContext = glossary ? `\nGame glossary for reference:\n${glossary.slice(0, 3000)}` : '';
      systemPrompt = `You are a professional video game localization QA reviewer for Xenoblade Chronicles 3 Arabic translation.
Review each translation for contextual accuracy in the game's universe.
Check for:
1. Character names used correctly and consistently
2. Game terminology matching the glossary
3. Tone appropriate for the context (battle cries, menus, dialogue)
4. Gender agreement in Arabic
5. Logical sense in game context

Return a JSON array of objects. For each entry that has issues, include:
{ "key": "entry_key", "issues": ["issue description 1", "issue description 2"], "suggestion": "suggested fix if applicable" }

Only include entries that have actual contextual issues. If an entry is fine, skip it.
Return ONLY the JSON array, no other text.${glossaryContext}`;
      userPrompt = `Review these translations:\n${entries.map((e: any) => `[${e.key}] EN: ${e.original}\nAR: ${e.translation}`).join('\n\n')}`;

    } else if (style === 'batch-improve') {
      if (!entries || !Array.isArray(entries)) {
        return new Response(JSON.stringify({ error: 'Missing entries array' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const improvementStyle = body.improvementStyle || 'natural';
      const styleGuides: Record<string, string> = {
        natural: 'Make the Arabic sound natural and fluent.',
        formal: 'Use formal/classical Arabic.',
        concise: 'Make translations more concise.',
        expressive: 'Make translations more expressive.',
      };
      const guide = styleGuides[improvementStyle] || styleGuides.natural;
      const glossaryContext = glossary ? `\nGame glossary:\n${glossary.slice(0, 3000)}` : '';
      // Shield tags in entries
      const shieldedBatch = entries.map((e: any) => {
        const { shielded: so } = shieldTags(e.original);
        const { shielded: st, slots } = shieldTags(e.translation);
        return { ...e, so, st, slots };
      });
      (body as any)._batchSlots = shieldedBatch.map((e: any) => e.slots);
      systemPrompt = `You are a professional Arabic video game localization expert.
Improve the Arabic translations following this style: ${guide}
Rules:
- ⚠️ Placeholders like ⟪T0⟫, ⟪T1⟫ are protected technical elements — keep them EXACTLY as-is
- Return a JSON array of objects: { "key": "entry_key", "improved": "improved Arabic text" }
- Only include entries where you actually made improvements
- Return ONLY the JSON array${glossaryContext}`;
      userPrompt = `Improve these translations:\n${shieldedBatch.map((e: any) => `[${e.key}] EN: ${e.so}\nAR: ${e.st}`).join('\n\n')}`;

    } else if (style === 'mismatch-detect') {
      // Detect misplaced translations using AI
      if (!entries || !Array.isArray(entries)) {
        return new Response(JSON.stringify({ error: 'Missing entries array' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      systemPrompt = `You are a professional video game translation QA expert.
You are given pairs of English original text and their Arabic translations.
Your job is to detect MISMATCHED translations — where an Arabic translation clearly does NOT correspond to its paired English original.

Signs of a mismatch:
1. The translation talks about a completely different topic than the original
2. Names/numbers/variables in the translation don't match the original
3. The translation appears to belong to a different entry entirely
4. The meaning is completely unrelated (not just a bad translation, but WRONG content)

Do NOT flag:
- Bad quality translations (those are still matched correctly)
- Literal translations (still correct target)
- Missing content (partial translations are OK)

Return a JSON array of objects for ONLY the mismatched entries:
{ "key": "entry_key", "reason": "brief Arabic explanation of why this is mismatched", "confidence": "high" or "medium" }

If all translations match their originals, return an empty array [].
Return ONLY the JSON array.`;
      userPrompt = `Check these translation pairs for mismatches:\n${entries.map((e: any) => `[${e.key}] EN: ${e.original}\nAR: ${e.translation}`).join('\n\n')}`;

    } else {
      // Style translation
      if (!text?.trim()) {
        return new Response(JSON.stringify({ error: 'No text provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const styleGuides: Record<string, string> = {
        formal: 'Use formal/classical Arabic (فصحى). Avoid colloquial expressions. Use dignified vocabulary suitable for epic narratives.',
        informal: 'Use casual/colloquial Arabic. Keep it natural and conversational, like everyday speech.',
        poetic: 'Use poetic/literary Arabic. Employ metaphors, alliteration, and rhythmic phrasing where appropriate.',
        gaming: 'Use modern gaming Arabic terminology. Keep it punchy, action-oriented, and exciting.',
      };
      const guide = styleGuides[style] || styleGuides.formal;
      systemPrompt = `You are a professional English-to-Arabic translator for video game localization.
Translate the text to Arabic following this style guide:
${guide}
- Preserve technical tags like [ML:...] and {variables} unchanged
- Return ONLY the Arabic translation, no explanations`;
      userPrompt = `Translate to Arabic:\n\n${text}`;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'تم تجاوز حد الطلبات، حاول لاحقاً' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'رصيد غير كافٍ، يرجى إضافة رصيد' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const t = await response.text();
      console.error('AI gateway error:', response.status, t);
      return new Response(JSON.stringify({ error: 'خطأ في خدمة الذكاء الاصطناعي' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim() || '';

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('translation-tools error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
