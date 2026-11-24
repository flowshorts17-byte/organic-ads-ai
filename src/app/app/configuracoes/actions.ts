"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

export type ProfileState = { error?: string; success?: string } | undefined;

export async function updateProfile(_: ProfileState, formData: FormData): Promise<ProfileState> {
  const parsed = z.string().trim().min(2, "Informe seu nome.").max(120).safeParse(formData.get("full_name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data }).eq("id", user.id);
  if (error) return { error: "Não foi possível salvar." };
  revalidatePath("/app");
  return { success: "Dados salvos." };
}
