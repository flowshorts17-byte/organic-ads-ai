import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON, type GeminiSchema } from "@/lib/ai/gemini";
import type { z } from "zod";

export type AgentCode =
  | "product_hunter"
  | "product_selector"
  | "audience_intelligence"
  | "strategy_builder"
  | "creative_generator"
  | "distribution_manager"
  | "performance_optimizer";

export type TaskRecord = {
  id: string;
  user_id: string;
  campaign_id: string;
  agent_code: AgentCode;
  input: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type CampaignRecord = {
  id: string;
  user_id: string;
  name: string;
  objective: string;
  market_country: string;
  market_region: string | null;
  language: string;
  niche_mode: "user_defined" | "ai_discovery";
  niche: string | null;
  product_mode: "user_defined" | "ai_discovery";
  product_hint: string | null;
  product_type: string;
  platforms: string[];
  status: string;
};

export type AgentContext = {
  db: SupabaseClient;
  task: TaskRecord;
  campaign: CampaignRecord;
};

export type AgentResult = {
  /** Resumo legível do que foi feito (aparece no painel). */
  summary: string;
  output: Record<string, unknown>;
  /** Próximos agentes a enfileirar. */
  next?: AgentCode[];
};

/** O agente precisa de algo do usuário (ex.: produtos reais). A tarefa termina sem erro, com aviso. */
export class NeedsInputError extends Error {
  constructor(message: string, public output: Record<string, unknown> = {}) {
    super(message);
    this.name = "NeedsInputError";
  }
}

/** Erro definitivo: não adianta tentar de novo sem mudança. */
export class AgentFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentFatalError";
  }
}

export async function recordDecision(
  ctx: AgentContext,
  d: { decision: string; justification: string; sources: { label: string; url?: string | null; quality: string }[]; confidence: number },
) {
  const { error } = await ctx.db.from("agent_decisions").insert({
    user_id: ctx.task.user_id,
    campaign_id: ctx.campaign.id,
    task_id: ctx.task.id,
    agent_code: ctx.task.agent_code,
    decision: d.decision.slice(0, 500),
    justification: d.justification.slice(0, 2000),
    sources: d.sources,
    confidence: clamp01(d.confidence),
  });
  if (error) throw new Error(`Falha ao registrar decisão: ${error.message}`);
}

export async function notify(ctx: AgentContext, title: string, body: string) {
  await ctx.db.from("notifications").insert({
    user_id: ctx.task.user_id,
    kind: `agent:${ctx.task.agent_code}`,
    title: title.slice(0, 200),
    body: body.slice(0, 1000),
    link: `/app/campanhas/${ctx.campaign.id}`,
  });
}

/** Chama o Gemini descontando 1 requisição do limite mensal do usuário. */
export async function askAI<T>(
  ctx: AgentContext,
  opts: { system: string; prompt: string; schema: GeminiSchema; validator: z.ZodType<T>; temperature?: number },
): Promise<T> {
  const { data: allowed, error } = await ctx.db.rpc("consume_ai_requests", { p_user: ctx.task.user_id, p_n: 1 });
  if (error) throw new Error(`Falha ao verificar limite de IA: ${error.message}`);
  if (!allowed) throw new AgentFatalError("Limite mensal de requisições de IA do plano atingido.");
  return generateJSON(opts);
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export function campaignBrief(c: CampaignRecord) {
  return [
    `Campanha: ${c.name}`,
    `Objetivo: ${c.objective}`,
    `Mercado: ${c.market_country}${c.market_region ? ` (${c.market_region})` : ""}`,
    `Idioma do público: ${c.language}`,
    `Nicho: ${c.niche ?? "não definido"}`,
    `Produto indicado pelo usuário: ${c.product_hint ?? "nenhum"}`,
    `Tipo de produto: ${c.product_type}`,
    `Plataformas: ${c.platforms.join(", ")}`,
    `Tráfego: somente orgânico (sem anúncios pagos)`,
  ].join("\n");
}

export const HONESTY_RULES =
  "Regras: nunca invente números, vendas, preços, avaliações, links ou fatos sobre produtos. " +
  "Use apenas os dados fornecidos. Quando algo for inferência sua, diga isso na justificativa. " +
  "Seja objetivo e escreva em português do Brasil.";
