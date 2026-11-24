import type { Metadata } from "next";
import { Field, Input } from "@/components/ui";
import { AuthForm } from "../auth-form";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "Nova senha" };

export default function ResetPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-white">Criar nova senha</h1>
      <p className="mb-6 text-sm text-white/60">Escolha uma senha com pelo menos 8 caracteres.</p>
      <AuthForm action={updatePassword} submitLabel="Salvar nova senha" pendingLabel="Salvando…">
        <Field label="Nova senha"><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <Field label="Confirmar senha"><Input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></Field>
      </AuthForm>
    </>
  );
}
