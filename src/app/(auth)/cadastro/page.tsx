import Link from "next/link";
import type { Metadata } from "next";
import { Field, Input } from "@/components/ui";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-white">Criar conta</h1>
      <p className="mb-6 text-sm text-white/60">Leva menos de um minuto.</p>
      <AuthForm action={signUp} submitLabel="Criar conta" pendingLabel="Criando…">
        <Field label="Nome"><Input name="full_name" autoComplete="name" required maxLength={120} /></Field>
        <Field label="E-mail"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres.">
          <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <label className="flex items-start gap-2 text-sm text-white/70">
          <input type="checkbox" name="lgpd" className="mt-0.5 accent-brand-500" required />
          <span>Concordo com o tratamento dos meus dados conforme a LGPD para uso da plataforma.</span>
        </label>
      </AuthForm>
      <p className="mt-5 text-center text-sm text-white/60">
        Já tem conta? <Link href="/login" className="text-brand-400 hover:underline">Entrar</Link>
      </p>
    </>
  );
}
