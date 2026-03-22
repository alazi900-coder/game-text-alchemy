import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface AnalysisEntry {
  key: string;
  original: string;
  translation: string;
  fileName?: string;
}

type AnalysisAction = 'literal-detect' | 'style-unify' | 'consistency-check' | 'alternatives' | 'full-analysis';

const gatewayModelMap: Record<string, string> = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gpt-5': 'openai/gpt-5',
};

// --- Unified Tag Protection ---
const TAG_PATTERNS: RegExp[] = [
  /\[\s*\w+:\w[^\]]*\][^[]*?\[\/\s*\w+:\w[^\]]*\]/g,
  /\[\s*M[A-Z]*ID_[^\]]+\]/g,
  /[\uE000-\uE0FF]+/g,
  /\$\w+\([^)]*\)/g,
  /\$\w+/g,
  /\[\s*\w+\s*:[^\]]*?\s*\]/g,
  /\[\s*\w+\s*=\s*\w[^\]]*\]/g,
  /\{\s*\w+\s*:\s*\w[^}]*\}/g,
  /\{\/\w+\}/g,
  /\{[\w]+\}/g,
  /%[sd]/g,
  /[\uFFF9-\uFFFC]/g,
  /<[\w\/][^>]*>/g,
  /[ɣɐɓɑɔɛɜɞɤɥɨɪɯɵɶʀʁʂʃʄʇʈ]/g,
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

const TAG_PROTECTION_RULE = `⚠️ قاعدة حرجة: الرموز مثل ⟪T0⟫ و ⟪T1⟫ هي عناصر تقنية محمية. يجب أن تبقى في مكانها تماماً بدون أي تعديل أو حذف أو ترجمة. انسخها حرفياً كما هي.`;

function buildPrompt(action: AnalysisAction, entries: { shieldedOrig: string; shieldedTrans: string; fileName?: string }[], glossary?: string, styleGuide?: string): string {
  const glossarySection = glossary ? `\nالقاموس المعتمد (التزم بهذه المصطلحات):\n${glossary.split('\n').slice(0, 100).join('\n')}` : '';

  if (action === 'literal-detect') {
    return `أنت خبير في كشف الترجمات الحرفية من الإنجليزية للعربية في ألعاب الفيديو (Xenoblade Chronicles 3).

مهمتك: فحص كل ترجمة وتحديد إن كانت حرفية (word-by-word) أو طبيعية.
${TAG_PROTECTION_RULE}
${glossarySection}

النصوص:
${entries.map((e, i) => `[${i}] EN: ${e.shieldedOrig}\nAR: ${e.shieldedTrans}`).join('\n\n')}

أجب بـ JSON فقط:
{
  "results": [
    {
      "index": 0,
      "isLiteral": true/false,
      "literalScore": 0-100,
      "issues": ["وصف المشكلة"],
      "naturalVersion": "الترجمة الطبيعية (مع ⟪T0⟫ في مكانها)",
      "explanation": "شرح التحسين"
    }
  ]
}`;
  }

  if (action === 'style-unify') {
    return `أنت خبير في توحيد أسلوب الترجمة للعربية في ألعاب الفيديو.
${TAG_PROTECTION_RULE}
${styleGuide ? `\nالأسلوب المطلوب: ${styleGuide}` : '\nالأسلوب: رسمي ملائم لعالم خيالي'}
${glossarySection}

النصوص:
${entries.map((e, i) => `[${i}] EN: ${e.shieldedOrig}\nAR: ${e.shieldedTrans}\nملف: ${e.fileName || 'غير محدد'}`).join('\n\n')}

أجب بـ JSON فقط:
{
  "results": [
    {
      "index": 0,
      "styleIssues": ["وصف مشكلة الأسلوب"],
      "currentTone": "formal/casual/mixed",
      "suggestedTone": "formal/casual",
      "unifiedVersion": "النص بعد توحيد الأسلوب (مع ⟪T0⟫ في مكانها)",
      "changes": ["التغيير المحدد"]
    }
  ],
  "globalNotes": ["ملاحظات عامة عن اتساق المشروع"]
}`;
  }

  if (action === 'consistency-check') {
    return `أنت خبير في فحص اتساق الترجمة في ألعاب الفيديو.
${TAG_PROTECTION_RULE}
${glossarySection}

النصوص:
${entries.map((e, i) => `[${i}] EN: ${e.shieldedOrig}\nAR: ${e.shieldedTrans}\nملف: ${e.fileName || '?'}`).join('\n\n')}

أجب بـ JSON فقط:
{
  "inconsistencies": [
    {
      "type": "terminology/character/style/glossary",
      "term": "المصطلح الإنجليزي",
      "variants": [{"index": 0, "text": "الترجمة1"}, {"index": 2, "text": "الترجمة2"}],
      "recommended": "الترجمة الموصى بها",
      "severity": "high/medium/low"
    }
  ],
  "score": 85,
  "summary": "ملخص عام لحالة الاتساق"
}`;
  }

  if (action === 'alternatives') {
    return `أنت مترجم ألعاب محترف متخصص في Xenoblade Chronicles 3.
${TAG_PROTECTION_RULE}
${glossarySection}

النصوص:
${entries.map((e, i) => `[${i}] EN: ${e.shieldedOrig}\nAR الحالي: ${e.shieldedTrans}`).join('\n\n')}

أجب بـ JSON فقط:
{
  "results": [
    {
      "index": 0,
      "alternatives": [
        {"style": "literary", "text": "... (مع ⟪T0⟫)", "note": "سبب الاختيار"},
        {"style": "natural", "text": "...", "note": "..."},
        {"style": "concise", "text": "...", "note": "..."},
        {"style": "dramatic", "text": "...", "note": "..."}
      ],
      "recommended": "literary/natural/concise/dramatic",
      "characterContext": "اسم الشخصية إن تم تحديدها"
    }
  ]
}`;
  }

  // full-analysis
  return `أنت خبير شامل في تحليل وتحسين ترجمات ألعاب الفيديو من الإنجليزية للعربية.
${TAG_PROTECTION_RULE}
${glossarySection}

النصوص:
${entries.map((e, i) => `[${i}] EN: ${e.shieldedOrig}\nAR: ${e.shieldedTrans}\nملف: ${e.fileName || '?'}`).join('\n\n')}

أجب بـ JSON فقط:
{
  "results": [
    {
      "index": 0,
      "literalScore": 0-100,
      "isLiteral": true/false,
      "sceneType": "combat/emotional/dialogue/system/tutorial",
      "character": "اسم الشخصية أو null",
      "tone": "formal/casual/dramatic/neutral",
      "issues": [{"type": "literal/awkward/inconsistent/style", "message": "...", "severity": "high/medium/low"}],
      "alternatives": [
        {"style": "literary", "text": "... (مع ⟪T0⟫)", "note": "..."},
        {"style": "natural", "text": "...", "note": "..."},
        {"style": "concise", "text": "...", "note": "..."}
      ],
      "recommended": "أفضل ترجمة مقترحة (مع ⟪T0⟫)"
    }
  ],
  "consistencyNotes": ["ملاحظات عن الاتساق العام"]
}`;
}

function parseAIResponse(content: string): any {
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    return JSON.parse((jsonMatch[1] || content).trim());
  } catch {
    const m = content.match(/"results"\s*:\s*(\[[\s\S]*?\])/);
    if (m) {
      try { return { results: JSON.parse(m[1]) }; } catch { /* ignore */ }
    }
    const m2 = content.match(/"inconsistencies"\s*:\s*(\[[\s\S]*?\])/);
    if (m2) {
      try { return { inconsistencies: JSON.parse(m2[1]) }; } catch { /* ignore */ }
    }
    return {};
  }
}

/** Recursively unshield all string values in parsed AI response */
function unshieldAllStrings(obj: any, slots: string[][]): any {
  if (typeof obj === 'string') {
    // Try each entry's slots to find the right one
    for (const entrySlots of slots) {
      if (entrySlots.length > 0) {
        const unshielded = unshieldTags(obj, entrySlots);
        if (unshielded !== obj) return unshielded;
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(item => unshieldAllStrings(item, slots));
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = unshieldAllStrings(value, slots);
    }
    return result;
  }
  return obj;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entries, action, glossary, aiModel, styleGuide } = await req.json() as {
      entries: AnalysisEntry[];
      action: AnalysisAction;
      glossary?: string;
      aiModel?: string;
      styleGuide?: string;
    };

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const resolvedModel = (aiModel && gatewayModelMap[aiModel]) || 'google/gemini-3-flash-preview';

    if (!entries?.length) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Shield tags before sending to AI
    const shieldedEntries = entries.map(e => {
      const { shielded: shieldedOrig, slots: origSlots } = shieldTags(e.original);
      const { shielded: shieldedTrans, slots: transSlots } = shieldTags(e.translation);
      return { ...e, shieldedOrig, shieldedTrans, origSlots, transSlots };
    });

    const prompt = buildPrompt(
      action,
      shieldedEntries.map(e => ({ shieldedOrig: e.shieldedOrig, shieldedTrans: e.shieldedTrans, fileName: e.fileName })),
      glossary,
      styleGuide,
    );

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: 'system', content: 'أنت محلل ترجمات ألعاب محترف. أجب دائماً بصيغة JSON صالحة فقط. لا تعدل أو تحذف الرموز ⟪T0⟫ أبداً.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 6000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'تم تجاوز حد الطلبات، حاول لاحقاً' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'يرجى شحن رصيد الذكاء الاصطناعي' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';
    let parsed = parseAIResponse(content);

    // Unshield tags in all string fields of the response
    const allSlots = shieldedEntries.map(e => e.transSlots);
    parsed = unshieldAllStrings(parsed, allSlots);

    return new Response(JSON.stringify({ action, ...parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
