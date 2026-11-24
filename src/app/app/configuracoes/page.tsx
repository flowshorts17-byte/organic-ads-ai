import type { Metadata } from "next";
import { Card, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { SUBSCRIPTION_STATUS_LABEL } from "@/lib/domain";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Conta" };

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const [profile, sub, limits] = await Promise.all([
    supabase.from("profiles").select("full_name").single(),
    supabase.from("subscriptions").select("plan_code,price_cents,status,current_period_end").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("usage_limits").select("max_campaigns,max_ai_requests,max_contents,used_ai_requests,used_contents").order("period_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const price = ((sub.data?.price_cents ?? 1790) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-white">Conta</h1>
      <Card>
        <SectionTitle>Perfil</SectionTitle>
        <p className="mb-3 text-sm text-white/60">{user.email}</p>
        <ProfileForm fullName={profile.data?.full_name ?? ""} />
      </Card>
      <Card>
        <SectionTitle>Assinatura</SectionTitle>
        <p className="text-sm text-white/85">Organic Starter · {price}/mês</p>
        <p className="text-sm text-white/60">Status: {SUBSCRIPTION_STATUS_LABEL[sub.data?.status ?? "pending_payment"]}</p>
        <p className="mt-2 text-xs text-white/45">O pagamento recorrente (Mercado Pago) será ativado na etapa de monetização.</p>
      </Card>
      {limits.data && (
        <Card>
          <SectionTitle>Limites do plano neste mês</SectionTitle>
          <ul className="space-y-1 text-sm text-white/80">
            <li>Campanhas abertas: até {limits.data.max_campaigns}</li>
            <li>Solicitações de IA: {limits.data.used_ai_requests} de {limits.data.max_ai_requests}</li>
            <li>Conteúdos gerados: {limits.data.used_contents} de {limits.data.max_contents}</li>
          </ul>
        </Card>
      )}
    </div>
  );
}
