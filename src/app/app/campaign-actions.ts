"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { campaignSchema } from "@/lib/domain";

export type CampaignFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function parseCampaign(formData: FormData) {
  return campaignSchema.safeParse({
    name: formData.get("name"),
    objective: formData.get("objective"),
    market_country: formData.get("market_country"),
    market_region: formData.get("market_region") ?? undefined,
    language: formData.get("language"),
    niche_mode: formData.get("niche_mode"),
    niche: formData.get("niche") ?? undefined,
    product_mode: formData.get("product_mode"),
    product_hint: formData.get("product_hint") ?? undefined,
    product_type: formData.get("product_type"),
    platforms: formData.getAll("platforms"),
    organic_only: formData.get("organic_only") === "on",
    approval_required: formData.get("approval_required") === "on",
  });
}

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

function dbError(message: string) {
  if (/Limite de/.test(message)) return "Você atingiu o limite de 3 campanhas abertas do plano. Encerre uma para criar outra.";
  return "Não foi possível salvar a campanha. Tente novamente.";
}

/** Cria a campanha, ativa e enfileira o primeiro agente (Product Hunter). */
export async function createCampaign(_: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const parsed = parseCampaign(formData);
  if (!parsed.success) return { error: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase, user } = await requireUser();
  const d = parsed.data;
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name: d.name,
      objective: d.objective,
      market_country: d.market_country,
      market_region: d.market_region ?? null,
      language: d.language,
      niche_mode: d.niche_mode,
      niche: d.niche_mode === "user_defined" ? d.niche : null,
      product_mode: d.product_mode,
      product_hint: d.product_mode === "user_defined" ? d.product_hint : null,
      product_type: d.product_type,
      platforms: d.platforms,
      organic_only: true,
      approval_required: d.approval_required,
      status: "active",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !campaign) return { error: dbError(error?.message ?? "") };

  const { error: taskError } = await supabase.from("agent_tasks").insert({
    user_id: user.id,
    campaign_id: campaign.id,
    agent_code: "product_hunter",
    input: { niche_mode: d.niche_mode, niche: d.niche ?? null, product_mode: d.product_mode, product_hint: d.product_hint ?? null },
    dedupe_key: `product_hunter:${campaign.id}`,
  });
  if (taskError && !/duplicate/i.test(taskError.message)) {
    // A campanha existe; a tarefa pode ser reenfileirada na página da campanha.
    console.error("enqueue failed", taskError.message);
  }

  await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", user.id);
  revalidatePath("/app");
  redirect(`/app/campanhas/${campaign.id}?criada=1`);
}

export async function updateCampaign(id: string, _: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Campanha inválida." };
  const parsed = parseCampaign(formData);
  if (!parsed.success) return { error: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const d = parsed.data;
  const { error } = await supabase
    .from("campaigns")
    .update({
      name: d.name,
      objective: d.objective,
      market_country: d.market_country,
      market_region: d.market_region ?? null,
      language: d.language,
      niche_mode: d.niche_mode,
      niche: d.niche_mode === "user_defined" ? d.niche : null,
      product_mode: d.product_mode,
      product_hint: d.product_mode === "user_defined" ? d.product_hint : null,
      product_type: d.product_type,
      platforms: d.platforms,
      approval_required: d.approval_required,
    })
    .eq("id", id)
    .neq("status", "ended");
  if (error) return { error: dbError(error.message) };
  revalidatePath(`/app/campanhas/${id}`);
  redirect(`/app/campanhas/${id}`);
}

const transitions: Record<string, { from: string[]; to: string }> = {
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  end: { from: ["active", "paused", "draft"], to: "ended" },
};

export async function changeCampaignStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  const t = transitions[op];
  if (!t || !z.string().uuid().safeParse(id).success) return;

  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = { status: t.to };
  if (t.to === "ended") patch.ended_at = new Date().toISOString();
  await supabase.from("campaigns").update(patch).eq("id", id).in("status", t.from);
  // Tarefas na fila de campanhas pausadas/encerradas são ignoradas pelo processador de agentes.
  revalidatePath(`/app/campanhas/${id}`);
  revalidatePath("/app");
}
