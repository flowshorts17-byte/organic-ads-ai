import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { CampaignWizard, type CampaignValues } from "../../../campaign-wizard";
import { updateCampaign } from "../../../campaign-actions";

export const metadata: Metadata = { title: "Editar campanha" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireUser();
  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).neq("status", "ended").maybeSingle();
  if (!c) notFound();

  const initial: CampaignValues = {
    name: c.name,
    objective: c.objective,
    market_country: c.market_country,
    market_region: c.market_region ?? "",
    language: c.language,
    niche_mode: c.niche_mode,
    niche: c.niche ?? "",
    product_mode: c.product_mode,
    product_hint: c.product_hint ?? "",
    product_type: c.product_type,
    platforms: c.platforms ?? [],
    organic_only: true,
    approval_required: c.approval_required,
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold text-white">Editar campanha</h1>
      <Card><CampaignWizard action={updateCampaign.bind(null, id)} initial={initial} submitLabel="Salvar alterações" /></Card>
    </div>
  );
}
