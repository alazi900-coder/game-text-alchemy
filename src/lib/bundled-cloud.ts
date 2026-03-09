import { supabase } from "@/integrations/supabase/client";

const BUCKET = "bundled-translations";
const FILE_NAME = "bundled-translations.json";

/**
 * Fetch bundled translations from cloud storage.
 * Falls back to the local /bundled-translations.json if cloud is empty.
 */
export async function fetchBundledTranslations(): Promise<Record<string, string>> {
  try {
    // Try cloud storage first
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(FILE_NAME);

    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (Object.keys(parsed).length > 0) return parsed;
    }
  } catch {
    // Cloud unavailable, fall through to local
  }

  // Fallback to local file
  const resp = await fetch("/bundled-translations.json");
  if (!resp.ok) return {};
  return resp.json();
}

/**
 * Upload bundled translations to cloud storage so all users can access them.
 */
export async function uploadBundledTranslations(
  data: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });

  // Try upsert (update if exists, insert if not)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(FILE_NAME, blob, { upsert: true });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
