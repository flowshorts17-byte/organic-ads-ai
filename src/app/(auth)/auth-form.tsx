"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { AuthState } from "./actions";

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  if (state?.success) return <Alert tone="success">{state.success}</Alert>;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {children}
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton className="w-full" pendingText={pendingLabel}>{submitLabel}</SubmitButton>
    </form>
  );
}
