import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  CAMPAIGN_STATUS_LABEL, COUNTRIES, LANGUAGES, OBJECTIVES, PLATFORMS, PRODUCT_TYPES, TASK_STATUS_LABEL, labelOf,
} from "@/lib/domain";
import { changeCampaignStatus } from "../../campaign-actions";

export const metadata: Metadata = { title: "Campanha" };
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const UUID = /^[0-9a-f-]{36}$/i;

function StatusButton({ id, op, label, variant }: { id: string; op: string; label: string; variant?: "secondary" | "danger" }) {
  return (
    <form action={changeCampaignStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <Button variant={variant ?? "secondary"}>{label}</Button>
    </form>
  );
}

export default async function CampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string }>;
}) {
  const { id } = await params;
  const { criada } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireUser();

  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [products, audiences, strategies, contents, posts, tasks, history] = await Promise.all([
    supabase.from("products").select("id,title,data_quality,selected").eq("campaign_id", id).limit(10),
    supabase.from("audiences").select("id,name,buying_intent").eq("campaign_id", id),
    supabase.from("strategies").select("id,positioning,version").eq("campaign_id", id).eq("is_current", true).maybeSingle(),
    supabase.from("content_assets").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("scheduled_posts").select("id,platform,scheduled_for,status").eq("campaign_id", id).order("scheduled_for").limit(10),
    supabase.from("agent_tasks").select("id,agent_code,status,created_at,ai_agents(name)").eq("campaign_id", id).order("created_at", { ascending: false }),
    supabase.from("audit_logs").select("id,action,details,created_at").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);

  const info: [string, string][] = [
    ["Objetivo", labelOf(OBJECTIVES, c.objective)],
    ["Mercado", `${labelOf(COUNTRIES, c.market_country)}${c.market_region ? ` · ${c.market_region}` : ""}`],
    ["Idioma", labelOf(LANGUAGES, c.language)],
    ["Nicho", c.niche_mode === "ai_discovery" ? "A IA escolhe" : c.niche],
    ["Produto", c.product_mode === "ai_discovery" ? "A IA encontra" : c.product_hint],
    ["Tipo de produto", labelOf(PRODUCT_TYPES, c.product_type)],
    ["Plataformas", (c.platforms as string[]).map((p) => labelOf(PLATFORMS, p)).join(", ")],
    ["Tráfego", "Somente orgânico"],
    ["Aprovação", c.approval_required ? "Manual" : "Automática"],
  ];

  return (
    <div className="space-y-6">
      {criada && <Alert tone="success">Campanha criada e ativada. O Product Hunter entrou na fila de trabalho.</Alert>}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">{c.name}</h1>
            <Badge tone={c.status === "active" ? "green" : c.status === "paused" ? "amber" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
          </div>
          <p className="text-sm text-white/50">Criada em {fmt.format(new Date(c.created_at))}</p>
        </div>
        {c.status !== "ended" && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/app/campanhas/${id}/editar`} variant="secondary">Editar</ButtonLink>
            {c.status === "active" && <StatusButton id={id} op="pause" label="Pausar" />}
            {c.status === "paused" && <StatusButton id={id} op="resume" label="Retomar" />}
            <StatusButton id={id} op="end" label="Encerrar" variant="danger" />
          </div>
        )}
      </div>

      <Card>
        <SectionTitle>Configuração</SectionTitle>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {info.map(([k, v]) => <div key={k}><dt className="text-white/50">{k}</dt><dd className="text-white">{v}</dd></div>)}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Trabalho da IA nesta campanha</SectionTitle>
          {(tasks.data ?? []).length === 0 ? <EmptyState>Nenhuma tarefa registrada.</EmptyState> : (
            <ul className="space-y-2">
              {(tasks.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-white/90">{(t.ai_agents as unknown as { name: string } | null)?.name ?? t.agent_code}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-white/45">{fmt.format(new Date(t.created_at))}</span>
                    <Badge tone={t.status === "succeeded" ? "green" : t.status === "failed" ? "red" : "amber"}>{TASK_STATUS_LABEL[t.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Produtos</SectionTitle>
          {(products.data ?? []).length === 0 ? <EmptyState>Nenhum produto encontrado ainda.</EmptyState> : (
            <ul className="space-y-1.5 text-sm">
              {(products.data ?? []).map((p) => <li key={p.id} className="text-white/85">{p.title}</li>)}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Público-alvo e estratégia</SectionTitle>
          {(audiences.data ?? []).length === 0 && !strategies.data ? <EmptyState>Público e estratégia ainda não foram gerados.</EmptyState> : (
            <div className="space-y-2 text-sm text-white/85">
              {(audiences.data ?? []).map((a) => <p key={a.id}>Público: {a.name}</p>)}
              {strategies.data && <p>Estratégia v{strategies.data.version}: {strategies.data.positioning}</p>}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Conteúdos e calendário</SectionTitle>
          {(contents.count ?? 0) === 0 && (posts.data ?? []).length === 0 ? <EmptyState>Nenhum conteúdo produzido ainda.</EmptyState> : (
            <div className="space-y-2 text-sm text-white/85">
              <p>{contents.count ?? 0} conteúdos produzidos</p>
              {(posts.data ?? []).map((p) => <p key={p.id}>{labelOf(PLATFORMS, p.platform)} · {fmt.format(new Date(p.scheduled_for))} · {p.status}</p>)}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Histórico</SectionTitle>
        <ul className="space-y-2 text-sm">
          {(history.data ?? []).map((h) => {
            const d = h.details as { from?: string; to?: string };
            return (
              <li key={h.id} className="flex justify-between gap-3">
                <span className="text-white/85">
                  {h.action === "campaign_created" ? "Campanha criada" : `Status: ${CAMPAIGN_STATUS_LABEL[d.from ?? ""] ?? d.from} → ${CAMPAIGN_STATUS_LABEL[d.to ?? ""] ?? d.to}`}
                </span>
                <span className="shrink-0 text-xs text-white/45">{fmt.format(new Date(h.created_at))}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
