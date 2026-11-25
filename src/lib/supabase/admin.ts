import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

/** Cliente com service_role: ignora a RLS. Usar SOMENTE no servidor (processador de agentes). */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new MissingConfigError("SUPABASE_SERVICE_ROLE_KEY");
  const { url } = getSupabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isAdminConfigured() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class MissingConfigError extends Error {
  constructor(public variable: string) {
    super(`Configuração ausente: ${variable}`);
    this.name = "MissingConfigError";
  }
}
