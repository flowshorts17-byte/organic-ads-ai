"use client";

import { useActionState, useEffect, useRef } from "react";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addProduct, type ProductFormState } from "../../agent-actions";

/** Formulário para o usuário adicionar um produto real (ex.: seu link de afiliado). */
export function ProductForm({ campaignId }: { campaignId: string }) {
  const [state, action] = useActionState<ProductFormState, FormData>(addProduct.bind(null, campaignId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <Field label="Nome do produto">
        <Input name="title" required maxLength={300} placeholder="Ex.: Garrafa térmica 1L inox" />
      </Field>
      <Field label="Link (afiliado ou página do produto)" hint="Opcional. Precisa começar com https://">
        <Input name="url" type="url" inputMode="url" maxLength={1000} placeholder="https://" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Preço (R$)" hint="Opcional">
          <Input name="price" inputMode="decimal" placeholder="89,90" />
        </Field>
        <Field label="Comissão (%)" hint="Opcional">
          <Input name="commission" inputMode="decimal" placeholder="12" />
        </Field>
      </div>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">Produto adicionado. A IA vai repontuar os produtos na próxima execução.</Alert>}
      <SubmitButton pendingText="Salvando…">Adicionar produto</SubmitButton>
    </form>
  );
}
