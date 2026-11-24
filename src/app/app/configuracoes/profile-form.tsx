"use client";
import { useActionState } from "react";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { updateProfile } from "./actions";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="Nome"><Input name="full_name" defaultValue={fullName} maxLength={120} required /></Field>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <SubmitButton pendingText="Salvando…">Salvar</SubmitButton>
    </form>
  );
}
