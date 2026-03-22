import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnhanceEntry {
  key: string;
  original: string;
  translation: string;
  fileName?: string;
  tableName?: string;
}

interface EnhanceResult {
  key: string;
  original: string;
  currentTranslation: string;
  context: {
    character?: string;
    sceneType: 'combat' | 'emotional' | 'system' | 'dialogue' | 'tutorial' | 'unknown';
    tone: 'formal' | 'casual' | 'dramatic' | 'neutral';
  };
  issues: Array<{
    type: 'literal' | 'awkward' | 'inconsistent' | 'context_mismatch' | 'style';
    message: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  suggestions: Array<{
    text: string;
    reason: string;
    style: 'literary' | 'natural' | 'concise' | 'dramatic';
  }>;
  preferredSuggestion?: string;
}

// --- Unified Tag Protection (strongest pattern set) ---
const TAG_PATTERNS: RegExp[] = [
  /\[\s*\w+:\w[^\]]*\][^[]*?\[\/\s*\w+:\w[^\]]*\]/g, // Paired tags
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
      `⟪T${i}⟫`, `T${i}`,
    ];
    for (const v of variants) {
      if (result.includes(v)) { result = result.replace(v, slots[i]); break; }
    }
  }
  // Clean any remaining unmatched placeholders
  result = result.replace(/⟪T\d+⟫/g, '');
  // Post-validation: re-insert any tags that got completely lost
  for (let i = 0; i < slots.length; i++) {
    if (!result.includes(slots[i])) {
      result = result.trimEnd() + ' ' + slots[i];
    }
  }
  return result;
}

// Detect scene type from file name and content
function detectSceneType(fileName: string, original: string): 'combat' | 'emotional' | 'system' | 'dialogue' | 'tutorial' | 'unknown' {
  const fn = fileName?.toLowerCase() || '';
  const orig = original?.toLowerCase() || '';
  
  if (fn.includes('btl') || fn.includes('battle') || /\b(attack|damage|hp|skill|buff|debuff|combo|chain)\b/i.test(orig)) return 'combat';
  if (fn.includes('ev_') || fn.includes('event') || /\b(sorry|thank|love|miss|remember|goodbye|promise|forever)\b/i.test(orig)) return 'emotional';
  if (fn.includes('mnu') || fn.includes('sys') || fn.includes('ui') || /\b(menu|option|setting|select|confirm|cancel|save|load)\b/i.test(orig)) return 'system';
  if (fn.includes('tuto') || fn.includes('help') || /\b(tutorial|tip|hint|learn|guide|how to)\b/i.test(orig)) return 'tutorial';
  if (fn.includes('msg_') || fn.includes('talk') || fn.includes('npc')) return 'dialogue';
  return 'unknown';
}

function detectCharacter(original: string, fileName: string): string | undefined {
  const characters = ['Noah', 'Mio', 'Eunie', 'Taion', 'Lanz', 'Sena', 'Ethel', 'Cammuravi', 'Monica', 'Guernica', 'Moebius', 'Consul'];
  for (const char of characters) {
    if (original.includes(char) || fileName?.toLowerCase().includes(char.toLowerCase())) return char;
  }
  if (/\b(mate|blimey|innit)\b/i.test(original)) return 'Eunie';
  if (/\b(logically|therefore|analysis)\b/i.test(original)) return 'Taion';
  if (/\b(smash|crush|strong)\b/i.test(original)) return 'Lanz';
  if (/\b(ouroboros|interlink|moebius)\b/i.test(original)) return 'System';
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entries, action, glossary, aiModel } = await req.json() as {
      entries: EnhanceEntry[];
      action: 'analyze' | 'enhance' | 'alternatives';
      glossary?: string;
      aiModel?: string;
    };

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const gatewayModelMap: Record<string, string> = {
      'gemini-2.5-flash': 'google/gemini-2.5-flash',
      'gemini-2.5-pro': 'google/gemini-2.5-pro',
      'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
      'gpt-5': 'openai/gpt-5',
    };
    const resolvedModel = (aiModel && gatewayModelMap[aiModel]) || 'google/gemini-3-flash-preview';

    if (!entries || entries.length === 0) {
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

    // Pre-analyze context for all entries
    const entriesWithContext = shieldedEntries.map(e => ({
      ...e,
      detectedContext: {
        sceneType: detectSceneType(e.fileName || '', e.original),
        character: detectCharacter(e.original, e.fileName || ''),
      }
    }));

    const analysisPrompt = `أنت خبير في تحسين ترجمات ألعاب الفيديو من الإنجليزية للعربية، متخصص في لعبة Xenoblade Chronicles 3.

مهمتك: تحليل الترجمات التالية وتقديم اقتراحات تحسين مع مراعاة:
1. السياق: من يتحدث؟ ما نوع المشهد (قتال/عاطفي/نظام)؟
2. الطبيعية: هل الترجمة تبدو طبيعية بالعربية أم حرفية جامدة؟
3. الأسلوب: هل يتناسب مع شخصية المتحدث ونبرة المشهد؟
4. البدائل: اقترح 2-3 بدائل مختلفة الأسلوب (أدبي، طبيعي، مختصر)

⚠️ قاعدة حرجة: الرموز مثل ⟪T0⟫ و ⟪T1⟫ هي عناصر تقنية محمية. يجب أن تبقى في مكانها تماماً بدون أي تعديل أو حذف أو ترجمة. انسخها حرفياً كما هي.

${glossary ? `القاموس المعتمد (التزم بهذه المصطلحات):\n${glossary.split('\n').slice(0, 100).join('\n')}` : ''}

النصوص للتحليل:
${entriesWithContext.map((e, i) => `[${i}] 
الإنجليزي: ${e.shieldedOrig}
الترجمة الحالية: ${e.shieldedTrans}
السياق المكتشف: ${e.detectedContext.sceneType}${e.detectedContext.character ? `, المتحدث: ${e.detectedContext.character}` : ''}`).join('\n\n')}

أجب بصيغة JSON:
{
  "results": [
    {
      "index": 0,
      "issues": [
        {"type": "literal|awkward|context_mismatch|style", "message": "وصف المشكلة", "severity": "high|medium|low"}
      ],
      "suggestions": [
        {"text": "الترجمة البديلة (احتفظ بجميع ⟪T0⟫ كما هي)", "reason": "سبب الاقتراح", "style": "literary|natural|concise|dramatic"}
      ],
      "preferredSuggestion": "أفضل اقتراح (مع جميع ⟪T0⟫ في مكانها)",
      "contextAdjustment": {
        "character": "اسم الشخصية إن تم تحديدها",
        "tone": "formal|casual|dramatic|neutral"
      }
    }
  ]
}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: 'system', content: 'أنت مترجم ألعاب محترف متخصص في Xenoblade Chronicles 3. أجب دائماً بصيغة JSON صالحة. لا تعدل أو تحذف الرموز المحمية ⟪T0⟫ أبداً.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
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
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';
    
    let parsed: { results: any[] } = { results: [] };
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      parsed = JSON.parse(jsonStr.trim());
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Content:', content.slice(0, 500));
      const resultsMatch = content.match(/"results"\s*:\s*\[([\s\S]*?)\]/);
      if (resultsMatch) {
        try { parsed = { results: JSON.parse(`[${resultsMatch[1]}]`) }; } catch { /* ignore */ }
      }
    }

    // Unshield tags in all AI suggestions
    const finalResults: EnhanceResult[] = entriesWithContext.map((entry, i) => {
      const aiAnalysis = parsed.results?.find((r: any) => r.index === i) || {};
      
      // Unshield tags in suggestions
      const suggestions = (aiAnalysis.suggestions || []).map((s: any) => ({
        ...s,
        text: s.text ? unshieldTags(s.text, entry.transSlots) : '',
      }));
      
      const preferredSuggestion = aiAnalysis.preferredSuggestion
        ? unshieldTags(aiAnalysis.preferredSuggestion, entry.transSlots)
        : undefined;

      return {
        key: entry.key,
        original: entry.original,
        currentTranslation: entry.translation,
        context: {
          character: aiAnalysis.contextAdjustment?.character || entry.detectedContext.character,
          sceneType: entry.detectedContext.sceneType,
          tone: aiAnalysis.contextAdjustment?.tone || 'neutral',
        },
        issues: aiAnalysis.issues || [],
        suggestions,
        preferredSuggestion,
      };
    });

    return new Response(JSON.stringify({ results: finalResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Enhancement error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
