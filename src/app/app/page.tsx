import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, SectionTitle, Stat } from "@/components/ui";
import { MyAI, type AgentRow, type DecisionRow, type TaskRow } from "@/components/my-ai";
import { requireUser } from "@/lib/auth";
import { CAMPAIGN_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/domain";

export const metadata: Metadata = { title: "Painel" };

const ACTION_LABEL: Record<string, string> = {
  signup: "Conta criada",
  campaign_created: "Campanha criada",
  campaign_status_changed: "Status de campanha alterado",
};
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  const { senha } = await searchParams;
  const { supabase } = await requireUser();
  const count = (table: string) => supabase.from(table).select("id", { count: "exact", head: true });

  const [
    profile, subscription, campaigns, selected, opportunities, contents, scheduled, published,
    links, conversions, agents, tasks, decisions, activity,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").single(),
    supabase.from("subscriptions").select("status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("campaigns").select("id,name,status,platforms,created_at").order("created_at", { ascending: false }),
    count("products").eq("selected", true),
    count("product_scores"),
    count("content_assets"),
    count("scheduled_posts").in("status", ["approved", "scheduled"]),
    count("published_posts"),
    supabase.from("tracked_links").select("clicks_count"),
    supabase.from("analytics").select("value").eq("metric", "conversions"),
    supabase.from("ai_agents").select("code,name,description,pipeline_order").eq("enabled", true).order("pipeline_order"),
    supabase.from("agent_tasks").select("id,agent_code,status,campaign_id,created_at,error,campaigns(name,status)").order("created_at", { ascending: false }).limit(30),
    supabase.from("agent_decisions").select("id,agent_code,decision,justification,confidence,sources,analyzed_at,observed_result").order("created_at", { ascending: false }).limit(5),
    supabase.from("audit_logs").select("id,action,details,created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  const camps = campaigns.data ?? [];
  const active = camps.filter((c) => c.status === "active");
  const clicks = (links.data ?? []).reduce((s, l) => s + (l.clicks_count ?? 0), 0);
  const conv = (conversions.data ?? []).reduce((s, r) => s + Number(r.value ?? 0), 0);
  const firstName = profile.data?.full_name?.split(" ")[0];

  return (
    <div className="space-y-6">
      {senha === "alterada" && <Alert tone="success">Senha alterada com sucesso.</Alert>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{firstName ? `Olá, ${firstName}` : "Seu painel"}</h1>
          <p className="text-sm text-white/60">
            Assinatura: {SUBSCRIPTION_STATUS_LABEL[subscription.data?.status ?? "pending_payment"]}
          </p>
        </div>
        <ButtonLink href="/app/onboarding">Nova campanha</ButtonLink>
      </div>

      {camps.length === 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-white">Comece pela sua primeira campanha</h2>
          <p className="mt-1 text-sm text-white/60">Escolha objetivo, mercado, nicho e plataformas. A IA começa a trabalhar a partir daí.</p>
          <ButtonLink href="/app/onboarding" className="mt-4">Configurar campanha</ButtonLink>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Campanhas ativas" value={active.length} />
        <Stat label="Produtos selecionados" value={selected.count ?? 0} />
        <Stat label="Oportunidades encontradas" value={opportunities.count ?? 0} />
        <Stat label="Conteúdos produzidos" value={contents.count ?? 0} />
        <Stat label="Publicações programadas" value={scheduled.count ?? 0} />
        <Stat label="Publicações realizadas" value={published.count ?? 0} />
        <Stat label="Cliques registrados" value={clicks} />
        <Stat label="Conversões atribuídas" value={conv} />
      </section>

      <MyAI
        agents={(agents.data ?? []) as AgentRow[]}
        tasks={(tasks.data ?? []) as unknown as TaskRow[]}
        decisions={(decisions.data ?? []) as DecisionRow[]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle aside={<Link href="/app/campanhas" className="text-xs text-brand-400 hover:underline">Ver todas</Link>}>Campanhas</SectionTitle>
          {camps.length === 0 ? <EmptyState>Nenhuma campanha ainda.</EmptyState> : (
            <ul className="divide-y divide-white/5">
              {camps.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/app/campanhas/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-white">
                    <span className="truncate text-sm text-white/90">{c.name}</span>
                    <Badge tone={c.status === "active" ? "green" : c.status === "paused" ? "amber" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Histórico de atividades</SectionTitle>
          {(activity.data ?? []).length === 0 ? <EmptyState>Sem atividades registradas.</EmptyState> : (
            <ul className="space-y-2">
              {(activity.data ?? []).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 text-sm">
                  <span className="text-white/85">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="shrink-0 text-xs text-white/45">{fmt.format(new Date(a.created_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Desempenho das campanhas</SectionTitle>
        <EmptyState>
          Os gráficos aparecem quando houver métricas reais coletadas das redes conectadas.
        </EmptyState>
      </Card>
    </div>
  );
}
