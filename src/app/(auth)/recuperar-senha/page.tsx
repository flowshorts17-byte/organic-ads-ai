import Link from "next/link";
import type { Metadata } from "next";
import { Field, Input } from "@/components/ui";
import { AuthForm } from "../auth-form";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-white">Recuperar senha</h1>
      <p className="mb-6 text-sm text-white/60">Enviaremos um link para você criar uma nova senha.</p>
      <AuthForm action={requestPasswordReset} submitLabel="Enviar link" pendingLabel="Enviando…">
        <Field label="E-mail"><Input name="email" type="email" autoComplete="email" required /></Field>
      </AuthForm>
      <p className="mt-5 text-center text-sm"><Link href="/login" className="text-brand-400 hover:underline">Voltar para o login</Link></p>
    </>
  );
}
