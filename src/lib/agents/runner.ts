import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "@/lib/ai/gemini";
import { SourceError } from "@/lib/sources/mercadolivre";
import { createAdminClient, MissingConfigError } from "@/lib/supabase/admin";
import { audienceIntelligence } from "./audience";
import { creativeGenerator } from "./creative";
import {
  AgentFatalError, NeedsInputError,
  type AgentCode, type AgentContext, type AgentResult, type CampaignRecord, type TaskRecord,
} from "./context";
import { productHunter } from "./product-hunter";
import { productSelector } from "./product-selector";
import { strategyBuilder } from "./strategy";

/** Agentes implementados (Etapas 2 e 3). Os demais chegam na etapa 4. */
const AGENTS: Partial<Record<AgentCode, (ctx: AgentContext) => Promise<AgentResult>>> = {
  product_hunter: productHunter,
  product_selector: productSelector,
  audience_intelligence: audienceIntelligence,
  strategy_builder: strategyBuilder,
  creative_generator: creativeGenerator,
};

export const IMPLEMENTED_AGENTS = Object.keys(AGENTS) as AgentCode[];

export type RunOutcome = { taskId: string; agent: string; status: "succeeded" | "needs_input" | "retry" | "failed"; message: string };

export async function runAgentQueue(opts: { userId?: string; campaignId?: string; maxTasks?: number; budgetMs?: number } = {}) {
  const db = createAdminClient();
  const started = Date.now();
  const maxTasks = opts.maxTasks ?? 1;
  const budget = opts.budgetMs ?? 25_000;
  const outcomes: RunOutcome[] = [];

  while (outcomes.length < maxTasks && Date.now() - started < budget) {
    const { data, error } = await db.rpc("claim_agent_task", {
      p_user: opts.userId ?? null,
      p_campaign: opts.campaignId ?? null,
    });
    if (error) throw new Error(`Falha ao buscar tarefa na fila: ${error.message}`);
    const task = (data as TaskRecord[] | null)?.[0];
    if (!task) break;
    outcomes.push(await runTask(db, task));
  }
  return outcomes;
}

async function runTask(db: SupabaseClient, task: TaskRecord): Promise<RunOutcome> {
  const finish = (patch: Record<string, unknown>) => db.from("agent_tasks").update(patch).eq("id", task.id);
  const base = { taskId: task.id, agent: task.agent_code };

  const agent = AGENTS[task.agent_code];
  if (!agent) {
    const message = "Este agente ainda não foi implementado (chega numa próxima etapa).";
    await finish({ status: "failed", error: message, finished_at: new Date().toISOString() });
    return { ...base, status: "failed", message };
  }

  const { data: campaign } = await db.from("campaigns").select("*").eq("id", task.campaign_id).single();
  if (!campaign) {
    await finish({ status: "canceled", error: "Campanha não encontrada.", finished_at: new Date().toISOString() });
    return { ...base, status: "failed", message: "Campanha não encontrada." };
  }

  const ctx: AgentContext = { db, task, campaign: campaign as CampaignRecord };
  try {
    const result = await agent(ctx);
    await finish({
      status: "succeeded",
      output: { summary: result.summary, ...result.output },
      finished_at: new Date().toISOString(),
    });
    for (const next of result.next ?? []) {
      try {
        await enqueue(db, task, next);
      } catch (err) {
        console.error((err as Error).message);
      }
    }
    return { ...base, status: "succeeded", message: result.summary };
  } catch (e) {
    if (e instanceof NeedsInputError) {
      await finish({
        status: "succeeded",
        output: { summary: e.message, needs_input: true, ...e.output },
        finished_at: new Date().toISOString(),
      });
      return { ...base, status: "needs_input", message: e.message };
    }

    const message = e instanceof MissingConfigError
      ? `Configuração ausente no servidor: ${e.variable}.`
      : (e as Error).message?.slice(0, 900) || "Erro desconhecido.";
    const retryable = (e instanceof AIError || e instanceof SourceError) && e.retryable && !(e instanceof AgentFatalError);

    if (retryable && task.attempts < task.max_attempts) {
      const delayMin = 2 ** task.attempts; // 2, 4, 8 minutos
      await finish({ status: "queued", error: message, run_after: new Date(Date.now() + delayMin * 60_000).toISOString() });
      return { ...base, status: "retry", message: `${message} Nova tentativa em ${delayMin} min.` };
    }

    await finish({ status: "failed", error: message, finished_at: new Date().toISOString() });
    await db.from("notifications").insert({
      user_id: task.user_id,
      kind: `agent:${task.agent_code}`,
      title: "Uma tarefa da IA falhou",
      body: message,
      link: `/app/campanhas/${task.campaign_id}`,
    });
    return { ...base, status: "failed", message };
  }
}

async function enqueue(db: SupabaseClient, from: TaskRecord, agent: AgentCode) {
  const { error } = await db.from("agent_tasks").insert({
    user_id: from.user_id,
    campaign_id: from.campaign_id,
    agent_code: agent,
    input: { triggered_by: from.id },
    dedupe_key: `${agent}:${from.campaign_id}`,
  });
  // 23505 = já existe uma tarefa aberta igual (dedupe): não duplica.
  if (error && error.code !== "23505") throw new Error(`Falha ao enfileirar ${agent}: ${error.message}`);
}
