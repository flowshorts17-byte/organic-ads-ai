"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isGeminiConfigured } from "@/lib/ai/gemini";
import { runAgentQueue } from "@/lib/agents/runner";
import { isAdminConfigured } from "@/lib/supabase/admin";

const uuid = z.string().uuid();

/** Processa agora as tarefas na fila DESTA campanha (do próprio usuário). */
export async function processNow(formData: FormData) {
  const id = String(formData.get("campaign_id") ?? "");
  if (!uuid.safeParse(id).success) return;
  const { supabase, user } = await requireUser();
  const { data: c } = await supabase.from("campaigns").select("id,status").eq("id", id).maybeSingle();
  if (!c) return;

  let query = "";
  if (!isAdminConfigured() || !isGeminiConfigured()) query = "?agentes=config";
  else if (c.status !== "active") query = "?agentes=inativa";
  else {
    try {
      const out = await runAgentQueue({ userId: user.id, campaignId: id, maxTasks: 4, budgetMs: 50_000 });
      query = `?agentes=ok&n=${out.length}`;
    } catch (e) {
      console.error("processNow", (e as Error).message);
      query = "?agentes=erro";
    }
  }
  revalidatePath(`/app/campanhas/${id}`);
  revalidatePath("/app");
  redirect(`/app/campanhas/${id}${query}`);
}

/** Reinicia a análise: coloca o Product Hunter na fila de novo. */
export async function rerunAnalysis(formData: FormData) {
  const id = String(formData.get("campaign_id") ?? "");
  if (!uuid.safeParse(id).success) return;
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("agent_tasks").insert({
    user_id: user.id,
    campaign_id: id,
    agent_code: "product_hunter",
    input: { reason: "manual_rerun" },
    dedupe_key: `product_hunter:${id}`,
  });
  const query = error ? (error.code === "23505" ? "?fila=ja" : "?fila=erro") : "?fila=ok";
  revalidatePath(`/app/campanhas/${id}`);
  redirect(`/app/campanhas/${id}${query}`);
}

/** Recoloca na fila uma tarefa que falhou (mesmo agente). */
export async function retryTask(formData: FormData) {
  const taskId = String(formData.get("task_id") ?? "");
  if (!uuid.safeParse(taskId).success) return;
  const { supabase, user } = await requireUser();
  const { data: t } = await supabase
    .from("agent_tasks").select("id,agent_code,campaign_id,status").eq("id", taskId).maybeSingle();
  if (!t || t.status !== "failed" || !t.campaign_id) return;
  const { error } = await supabase.from("agent_tasks").insert({
    user_id: user.id,
    campaign_id: t.campaign_id,
    agent_code: t.agent_code,
    input: { retry_of: t.id },
    dedupe_key: `${t.agent_code}:${t.campaign_id}`,
  });
  const query = error ? (error.code === "23505" ? "?fila=ja" : "?fila=erro") : "?fila=ok";
  revalidatePath(`/app/campanhas/${t.campaign_id}`);
  redirect(`/app/campanhas/${t.campaign_id}${query}`);
}

const productSchema = z.object({
  title: z.string().trim().min(3, "Informe o nome do produto.").max(300),
  url: z
    .string().trim().max(1000)
    .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Use um link que comece com https://")
    .transform((v) => v || null),
  price: z
    .string().trim()
    .refine((v) => v === "" || /^\d{1,7}([.,]\d{1,2})?$/.test(v), "Preço inválido (ex.: 89,90).")
    .transform((v) => (v ? Math.round(Number(v.replace(",", ".")) * 100) : null)),
  commission: z
    .string().trim()
    .refine((v) => v === "" || (/^\d{1,3}([.,]\d{1,2})?$/.test(v) && Number(v.replace(",", ".")) <= 100), "Comissão entre 0 e 100.")
    .transform((v) => (v ? Number(v.replace(",", ".")) : null)),
});

export type ProductFormState = { error?: string; ok?: boolean } | undefined;

/** Usuário adiciona um produto real (ex.: link de afiliado). Depois a IA repontua. */
export async function addProduct(campaignId: string, _: ProductFormState, formData: FormData): Promise<ProductFormState> {
  if (!uuid.safeParse(campaignId).success) return { error: "Campanha inválida." };
  const parsed = productSchema.safeParse({
    title: formData.get("title") ?? "",
    url: formData.get("url") ?? "",
    price: formData.get("price") ?? "",
    commission: formData.get("commission") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const { supabase, user } = await requireUser();
  const { data: source } = await supabase.from("product_sources").select("id").eq("code", "manual").single();
  const d = parsed.data;
  const { error } = await supabase.from("products").insert({
    user_id: user.id,
    campaign_id: campaignId,
    source_id: source?.id ?? null,
    title: d.title,
    url: d.url,
    affiliate_url: d.url,
    price_cents: d.price,
    commission_rate: d.commission,
    data_quality: "indirect",
    signals: { origin: "user" },
  });
  if (error) return { error: "Não foi possível salvar o produto." };

  await supabase.from("agent_tasks").insert({
    user_id: user.id,
    campaign_id: campaignId,
    agent_code: "product_selector",
    input: { reason: "product_added" },
    dedupe_key: `product_selector:${campaignId}`,
  });
  revalidatePath(`/app/campanhas/${campaignId}`);
  return { ok: true };
}

/** Remove um produto da campanha. */
export async function removeProduct(formData: FormData) {
  const id = String(formData.get("product_id") ?? "");
  const campaignId = String(formData.get("campaign_id") ?? "");
  if (!uuid.safeParse(id).success || !uuid.safeParse(campaignId).success) return;
  const { supabase } = await requireUser();
  await supabase.from("products").delete().eq("id", id).eq("campaign_id", campaignId);
  revalidatePath(`/app/campanhas/${campaignId}`);
}
