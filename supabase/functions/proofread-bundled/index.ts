import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

interface ProofreadEntry {
  key: string;
  arabic: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entries } = await req.json() as { entries: ProofreadEntry[] };

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    // Shield tags before sending to AI
    const shieldedEntries = entries.map(e => {
      const { shielded, slots } = shieldTags(e.arabic);
      return { ...e, shielded, slots };
    });

    // Process in chunks of 40
    const CHUNK_SIZE = 40;
    const allResults: { key: string; original: string; corrected: string }[] = [];

    for (let c = 0; c < shieldedEntries.length; c += CHUNK_SIZE) {
      const chunk = shieldedEntries.slice(c, c + CHUNK_SIZE);

      const prompt = `أنت مدقق لغوي عربي متخصص في ترجمات ألعاب الفيديو. مهمتك تصحيح الأخطاء الإملائية والنحوية فقط دون تغيير المعنى أو الأسلوب.

قواعد صارمة:
- صحّح الأخطاء الإملائية فقط (مثل: "الاعب" → "اللاعب"، "مفتوحه" → "مفتوحة")
- صحّح التاء المربوطة والمفتوحة إن كانت خاطئة
- صحّح الألف المقصورة واللينة (مثل: "الي" → "إلى")
- صحّح الهمزات الخاطئة (مثل: "مسئول" → "مسؤول")
- أزل المسافات الزائدة أو المكررة
- ⚠️ الرموز مثل ⟪T0⟫ و ⟪T1⟫ عناصر تقنية محمية — لا تعدلها أو تحذفها أبداً
- لا تغير المصطلحات الإنجليزية المتروكة عمداً
- إذا كان النص صحيحاً تماماً، أعد نفس النص بدون تغيير
- لا تضف تشكيلات أو حركات

النصوص:
${chunk.map((e, i) => `[${i}] "${e.shielded}"`).join('\n')}

أخرج JSON array فقط بنفس الترتيب يحتوي النصوص المصححة. مثال: ["نص مصحح 1", "نص مصحح 2"]`;

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'أنت مدقق إملائي عربي. أخرج ONLY JSON arrays. لا تضف أي نص آخر. لا تعدل رموز ⟪T0⟫.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('AI gateway error:', response.status, errText);
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: 'تم تجاوز حد الطلبات، حاول مرة أخرى لاحقاً' }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: 'الرصيد غير كافٍ، يرجى إضافة رصيد' }), {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`AI error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('Failed to parse AI response:', content.substring(0, 200));
        continue;
      }

      try {
        const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, ' ');
        const corrected: string[] = JSON.parse(sanitized);

        for (let i = 0; i < Math.min(chunk.length, corrected.length); i++) {
          const orig = chunk[i].arabic.trim();
          const fixed = unshieldTags(corrected[i]?.trim() || '', chunk[i].slots);
          if (fixed && fixed !== orig) {
            allResults.push({
              key: chunk[i].key,
              original: orig,
              corrected: fixed,
            });
          }
        }
      } catch (parseErr) {
        console.error('JSON parse error for chunk:', parseErr);
      }
    }

    return new Response(JSON.stringify({ results: allResults, total: entries.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Proofread error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'خطأ غير متوقع' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
