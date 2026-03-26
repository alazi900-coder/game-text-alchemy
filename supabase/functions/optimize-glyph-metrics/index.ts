import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { mode, glyph, glyphs, fontHeader } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert in game font engineering, specifically NLG font systems used in Nintendo Switch games like Luigi's Mansion 2 HD.

Your job is to optimize glyph metrics (Width, RenderWidth, XOffset) for Arabic characters injected into the game font.

Key rules for this game engine:
- Width = advance width (how much cursor moves after drawing). Should match the visual width of the glyph closely.
- RenderWidth = maximum rendering width. Should be >= Width and >= pixelWidth. Usually pixelWidth + some padding.
- XOffset = horizontal bearing offset. For Arabic, usually 0-2. Too high = gaps, too low = overlap.
- Arabic characters are RTL but the engine renders them LTR after reshaping.
- Presentation forms (0xFE70-0xFEFF, 0xFB50-0xFDFF) need careful Width because they connect.
- Width should generally be close to pixelWidth but can be slightly more for spacing.
- For connected Arabic forms (initial/medial), Width can be slightly less than pixelWidth for tighter joining.
- For isolated/final forms, Width should match pixelWidth + small padding (1-2px).

Font context: fontSize=${fontHeader.fontSize}, height=${fontHeader.height}, renderHeight=${fontHeader.renderHeight}, charSpacing=${fontHeader.charSpacing}

Return ONLY valid JSON. No markdown, no explanation.`;

    if (mode === "single") {
      const prompt = `Optimize metrics for this Arabic glyph:
Code: U+${glyph.code.toString(16).toUpperCase()} (${glyph.char})
Current: Width=${glyph.width}, RenderWidth=${glyph.renderWidth}, XOffset=${glyph.xOffset}
Pixel dimensions: ${glyph.pixelWidth}×${glyph.pixelHeight}

Return JSON: {"width": N, "renderWidth": N, "xOffset": N, "reasoning": "..."}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "set_glyph_metrics",
              description: "Set optimized glyph metrics",
              parameters: {
                type: "object",
                properties: {
                  width: { type: "integer", description: "Optimized advance width" },
                  renderWidth: { type: "integer", description: "Optimized render width" },
                  xOffset: { type: "integer", description: "Optimized X offset" },
                  reasoning: { type: "string", description: "Brief explanation" },
                },
                required: ["width", "renderWidth", "xOffset"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "set_glyph_metrics" } },
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI error: ${status}`);
      }

      const result = await response.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const args = JSON.parse(toolCall.function.arguments);
        return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error("No tool call in response");
    }

    // Batch mode
    if (mode === "batch" && glyphs) {
      const glyphList = glyphs.map((g: any) =>
        `U+${g.code.toString(16).toUpperCase()} "${g.char}" W=${g.width} RW=${g.renderWidth} XOff=${g.xOffset} px=${g.pixelWidth}×${g.pixelHeight}`
      ).join("\n");

      const prompt = `Optimize metrics for these ${glyphs.length} Arabic glyphs:
${glyphList}

Return JSON: {"results": [{"width": N, "renderWidth": N, "xOffset": N}, ...]}
One entry per glyph, same order.`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "set_batch_metrics",
              description: "Set optimized metrics for multiple glyphs",
              parameters: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        width: { type: "integer" },
                        renderWidth: { type: "integer" },
                        xOffset: { type: "integer" },
                      },
                      required: ["width", "renderWidth", "xOffset"],
                    },
                  },
                },
                required: ["results"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "set_batch_metrics" } },
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI error: ${status}`);
      }

      const result = await response.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const args = JSON.parse(toolCall.function.arguments);
        return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error("No tool call in response");
    }

    throw new Error("Invalid mode");
  } catch (e) {
    console.error("optimize-glyph-metrics error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
