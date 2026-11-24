import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Field, Input } from "@/components/ui";
import { AuthForm } from "../auth-form";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-white">Entrar</h1>
      <p className="mb-6 text-sm text-white/60">Acesse sua IA de marketing.</p>
      {erro === "config" && <div className="mb-4"><Alert tone="error">O banco de dados ainda não foi conectado.</Alert></div>}
      {erro === "link" && <div className="mb-4"><Alert tone="error">Link inválido ou expirado. Tente novamente.</Alert></div>}
      <AuthForm action={signIn} submitLabel="Entrar" pendingLabel="Entrando…">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="E-mail"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Senha"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </AuthForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/recuperar-senha" className="text-brand-400 hover:underline">Esqueci minha senha</Link>
        <Link href="/cadastro" className="text-white/70 hover:text-white">Criar conta</Link>
      </div>
    </>
  );
}
