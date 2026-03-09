const ALLOWED_HOSTNAMES = [
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
  "fonts.gstatic.com",
  "github.com",
];

function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTNAMES.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let fontUrl: string;
  try {
    const body = await req.json();
    fontUrl = body.fontUrl;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!fontUrl || !isAllowedUrl(fontUrl)) {
    return new Response(JSON.stringify({ error: "Disallowed font URL" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(fontUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FontProxy/1.0)" },
    });

    if (!response.ok) {
      throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
    }

    const fontData = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    return new Response(fontData, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Length": fontData.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("font-proxy error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
