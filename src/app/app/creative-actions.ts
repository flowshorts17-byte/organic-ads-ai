"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

const uuid = z.string().uuid();

/** Coloca o Creative Generator na fila (gera roteiros e narrações do calendário atual). */
export async function enqueueCreatives(formData: FormData) {
  const id = String(formData.get("campaign_id") ?? "");
  if (!uuid.safeParse(id).success) return;
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("agent_tasks").insert({
    user_id: user.id,
    campaign_id: id,
    agent_code: "creative_generator",
    input: { reason: "manual" },
    dedupe_key: `creative_generator:${id}`,
  });
  const query = error ? (error.code === "23505" ? "?fila=ja" : "?fila=erro") : "?fila=ok";
  revalidatePath(`/app/campanhas/${id}`);
  redirect(`/app/campanhas/${id}${query}`);
}

/** Desconta 1 conteúdo do limite do plano antes de montar um vídeo. */
export async function consumeContent(creativeId: string): Promise<{ ok: boolean; error?: string }> {
  if (!uuid.safeParse(creativeId).success) return { ok: false, error: "Conteúdo inválido." };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("consume_content", { p_creative: creativeId });
  if (error) return { ok: false, error: "Não foi possível verificar seu limite agora." };
  if (!data) return { ok: false, error: "Limite de conteúdos do plano atingido neste mês." };
  return { ok: true };
}
