import { isAdminConfigured } from "@/lib/supabase/admin";
import { runAgentQueue } from "@/lib/agents/runner";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Processador de agentes. Chamado pelo Cron Trigger da Cloudflare (a cada 2 minutos)
 * com o cabeçalho x-cron-secret = AGENTS_CRON_SECRET. Sem o segredo, responde 401.
 */
export async function POST(request: Request) {
  const secret = process.env.AGENTS_CRON_SECRET;
  const given = request.headers.get("x-cron-secret") ?? "";
  if (!secret || !safeEqual(given, secret)) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ausente" }, { status: 503 });
  }
  try {
    const outcomes = await runAgentQueue({ maxTasks: 3, budgetMs: 25_000 });
    return Response.json({ processed: outcomes.length, outcomes });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
