import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConsistencyEntry {
  key: string;
  original: string;
  translation: string;
  file: string;
}

interface InconsistencyGroup {
  term: string;
  variants: { key: string; translation: string; file: string }[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entries, glossary } = await req.json() as {
      entries: ConsistencyEntry[];
      glossary?: string;
    };

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ groups: [], aiSuggestions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Group by normalized original text to find inconsistencies
    const byOriginal = new Map<string, ConsistencyEntry[]>();
    for (const entry of entries) {
      const norm = entry.original.trim().toLowerCase();
      if (!norm || norm.length < 2) continue;
      if (!byOriginal.has(norm)) byOriginal.set(norm, []);
      byOriginal.get(norm)!.push(entry);
    }

    // Find groups with different translations for the same original
    const inconsistentGroups: InconsistencyGroup[] = [];
    for (const [term, group] of byOriginal) {
      if (group.length < 2) continue;
      const uniqueTranslations = new Set(group.map(e => e.translation.trim()));
      if (uniqueTranslations.size > 1) {
        inconsistentGroups.push({
          term: group[0].original, // keep original casing
          variants: group.map(e => ({ key: e.key, translation: e.translation, file: e.file })),
        });
      }
    }

    if (inconsistentGroups.length === 0) {
      return new Response(JSON.stringify({ groups: [], aiSuggestions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Use AI to suggest the best translation for each inconsistent group
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // Return groups without AI suggestions
      return new Response(JSON.stringify({ groups: inconsistentGroups, aiSuggestions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Limit to 50 groups to avoid token limits
    const groupsToCheck = inconsistentGroups.slice(0, 50);

    const prompt = `أنت خبير في اتساق مصطلحات ترجمة ألعاب الفيديو. لكل مصطلح إنجليزي أدناه، هناك عدة ترجمات عربية مختلفة مستخدمة في الملفات. اختر أفضل ترجمة واحدة لكل مصطلح واشرح السبب بجملة واحدة.

${glossary ? `القاموس المرجعي:\n${glossary}\n\n` : ''}المصطلحات:
${groupsToCheck.map((g, i) => `[${i}] "${g.term}" → الترجمات: ${[...new Set(g.variants.map(v => `"${v.translation}"`))].join(' | ')}`).join('\n')}

أخرج JSON array بنفس الترتيب:
[{"best": "أفضل ترجمة", "reason": "السبب"}, ...]`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'أنت خبير اتساق مصطلحات. أخرج ONLY JSON arrays.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "تم تجاوز حد الطلبات، يرجى المحاولة لاحقاً." }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "يرجى إضافة رصيد لاستخدام الذكاء الاصطناعي." }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const err = await response.text();
      console.error('AI gateway error:', response.status, err);
      // Return groups without AI suggestions on error
      return new Response(JSON.stringify({ groups: inconsistentGroups, aiSuggestions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    let aiSuggestions: { best: string; reason: string }[] = [];
    if (jsonMatch) {
      try {
        const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, ' ');
        aiSuggestions = JSON.parse(sanitized);
      } catch (e) {
        console.error('Failed to parse AI suggestions:', e);
      }
    }

    return new Response(JSON.stringify({
      groups: inconsistentGroups,
      aiSuggestions,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Consistency check error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'خطأ غير متوقع' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
