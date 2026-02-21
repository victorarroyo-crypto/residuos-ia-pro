import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "@/lib/env";

type AdminOk = { ok: true; client: SupabaseClient };
type AdminErr = { ok: false; error: string; status: number; detail: string };
export type AdminResult = AdminOk | AdminErr;

/**
 * Centralised Supabase admin client (service-role).
 * Used by all API routes that need elevated privileges.
 *
 * Returns { ok: true, client } on success or { ok: false, error, status, detail }
 * on failure so the caller can immediately return an HTTP response.
 */
export function getAdminClient(): AdminResult {
  const supabaseUrl =
    loadEnv("NEXT_PUBLIC_SUPABASE_URL") || loadEnv("SUPABASE_URL");
  const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) {
    const detail =
      "NEXT_PUBLIC_SUPABASE_URL (ni SUPABASE_URL) no esta configurado. " +
      "Añadelo en Vercel > Settings > Environment Variables.";
    console.error("[supabase/admin]", detail);
    return { ok: false, error: "supabase_url_missing", status: 503, detail };
  }

  if (!serviceKey) {
    const detail =
      "SUPABASE_SERVICE_ROLE_KEY no esta configurado. " +
      "Ve a Supabase Dashboard > Settings > API, copia la clave service_role " +
      "y añadela en Vercel > Settings > Environment Variables.";
    console.error("[supabase/admin]", detail);
    return { ok: false, error: "service_key_missing", status: 503, detail };
  }

  // Detect stale JWT keys after Supabase migrated to v2 key format.
  // v2 keys start with "sb_" (e.g. sb_secret_…), old keys start with "eyJ".
  // If the anon key is already v2 but the service key is still JWT, warn.
  const anonKey = loadEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (anonKey.startsWith("sb_") && serviceKey.startsWith("eyJ")) {
    console.warn(
      "[supabase/admin] SUPABASE_SERVICE_ROLE_KEY parece estar en formato " +
        "JWT antiguo mientras que ANON_KEY ya usa el formato v2 (sb_…). " +
        "Es probable que la clave service_role haya sido rotada. " +
        "Actualizala desde Supabase Dashboard > Settings > API."
    );
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { ok: true, client };
}
