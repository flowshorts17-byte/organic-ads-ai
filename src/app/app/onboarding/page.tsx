import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { CampaignWizard } from "../campaign-wizard";
import { createCampaign } from "../campaign-actions";

export const metadata: Metadata = { title: "Nova campanha" };

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-white">Configure sua campanha</h1>
      <p className="mb-6 mt-1 text-sm text-white/60">Ao confirmar, a campanha é ativada e o primeiro agente entra na fila de trabalho.</p>
      <Card><CampaignWizard action={createCampaign} submitLabel="Confirmar e iniciar a IA" /></Card>
    </div>
  );
}
