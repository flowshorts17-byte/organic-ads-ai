"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, siteUrl } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";

export type AuthState = { error?: string; success?: string } | undefined;

const email = z.string().trim().toLowerCase().email("E-mail inválido.").max(254);
const password = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72);

const NOT_CONFIGURED: AuthState = {
  error: "O banco de dados ainda não foi conectado (variáveis do Supabase ausentes).",
};

function translate(message: string) {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/already registered|already been registered/i.test(message)) return "Este e-mail já tem conta. Tente entrar.";
  if (/rate limit|too many/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (/same.*password|different from the old/i.test(message)) return "A nova senha precisa ser diferente da atual.";
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return process.env.NEXT_PUBLIC_SITE_URL ? siteUrl() : host ? `${proto}://${host}` : siteUrl();
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = z.object({ email, password: z.string().min(1, "Informe a senha.") }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: translate(error.message) };
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = z
    .object({
      full_name: z.string().trim().min(2, "Informe seu nome.").max(120),
      email,
      password,
      lgpd: z.literal("on", { message: "É preciso aceitar os termos e a política de privacidade." }),
    })
    .safeParse({
      full_name: formData.get("full_name"),
      email: formData.get("email"),
      password: formData.get("password"),
      lgpd: formData.get("lgpd"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await origin()}/auth/confirm?next=/app/onboarding`,
      data: { full_name: parsed.data.full_name, lgpd_consent: "true" },
    },
  });
  if (error) return { error: translate(error.message) };
  if (data.session) redirect("/app/onboarding");
  return { success: "Conta criada! Enviamos um link de confirmação para o seu e-mail." };
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/confirm?next=/redefinir-senha`,
  });
  if (error && /rate limit|too many/i.test(error.message)) return { error: translate(error.message) };
  // Resposta igual exista ou não a conta (evita descobrir e-mails cadastrados).
  return { success: "Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha." };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((d) => d.password === d.confirm, { message: "As senhas não conferem." })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "O link expirou. Peça um novo em “Esqueci minha senha”." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: translate(error.message) };
  redirect("/app?senha=alterada");
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
