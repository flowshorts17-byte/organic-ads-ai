import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { isGeminiConfigured } from "@/lib/ai/gemini";
import { isMercadoLivreConfigured } from "@/lib/sources/mercadolivre";
import { isAdminConfigured } from "@/lib/supabase/admin";
import {
  CAMPAIGN_STATUS_LABEL, COUNTRIES, LANGUAGES, OBJECTIVES, PLATFORMS, PRODUCT_TYPES, TASK_STATUS_LABEL, labelOf,
} from "@/lib/domain";
import { changeCampaignStatus } from "../../campaign-actions";
import { processNow, removeProduct, rerunAnalysis, retryTask } from "../../agent-actions";
import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Campanha" };
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const UUID = /^[0-9a-f-]{36}$/i;

const QUALITY: Record<string, { label: string; tone: "green" | "amber" | "neutral" }> = {
  verified: { label: "Dado verificado", tone: "green" },
  estimated: { label: "Inclui estimativa da IA", tone: "amber" },
  indirect: { label: "Informado/indireto", tone: "neutral" },
};

type ScoreRow = { score: number; rationale: string; confidence: number; data_quality: string; created_at: string };
type ProductRow = {
  id: string; title: string; url: string | null; image_url: string | null; price_cents: number | null;
  commission_rate: number | null; data_quality: string; selected: boolean; category: string | null;
  signals: { origin?: string; ml_position?: number } | null;
  product_scores: ScoreRow[];
};
type CalendarItem = { day: number; platform: string; format: string; angle: string; product: string; goal: string };

function StatusButton({ id, op, label, variant }: { id: string; op: string; label: string; variant?: "secondary" | "danger" }) {
  return (
    <form action={changeCampaignStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <Button variant={variant ?? "secondary"}>{label}</Button>
    </form>
  );
}

const FLASH: Record<string, { tone: "success" | "error" | "info"; text: string }> = {
  "agentes=config": { tone: "error", text: "O processamento de IA ainda não está configurado no servidor." },
  "agentes=inativa": { tone: "info", text: "A campanha precisa estar ativa para a IA trabalhar." },
  "agentes=erro": { tone: "error", text: "Não foi possível processar agora. A fila continua e será tentada automaticamente." },
  "fila=ok": { tone: "success", text: "Tarefa colocada na fila." },
  "fila=ja": { tone: "info", text: "Essa tarefa já está na fila." },
  "fila=erro": { tone: "error", text: "Não foi possível colocar a tarefa na fila." },
};

export default async function CampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string; agentes?: string; n?: string; fila?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const { supabase, user } = await requireUser();

  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [products, audiences, strategy, contents, posts, tasks, decisions, history, me] = await Promise.all([
    supabase
      .from("products")
      .select("id,title,url,image_url,price_cents,commission_rate,data_quality,selected,category,signals,product_scores(score,rationale,confidence,data_quality,created_at)")
      .eq("campaign_id", id)
      .order("created_at", { referencedTable: "product_scores", ascending: false })
      .limit(1, { referencedTable: "product_scores" })
      .limit(30),
    supabase.from("audiences").select("id,name,persona,pains,interests,buying_intent,rationale,confidence").eq("campaign_id", id),
    supabase.from("strategies").select("id,positioning,sales_angles,formats,calendar_plan,version,rationale,confidence,created_at").eq("campaign_id", id).eq("is_current", true).maybeSingle(),
    supabase.from("content_assets").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("scheduled_posts").select("id,platform,scheduled_for,status").eq("campaign_id", id).order("scheduled_for").limit(10),
    supabase.from("agent_tasks").select("id,agent_code,status,created_at,finished_at,error,output,attempts,run_after,ai_agents(name)").eq("campaign_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("agent_decisions").select("id,agent_code,decision,justification,confidence,sources,analyzed_at").eq("campaign_id", id).order("created_at", { ascending: false }).limit(8),
    supabase.from("audit_logs").select("id,action,details,created_at").eq("entity_id", id).order("created_at", { ascending: false }),
    supabase.from("users").select("role").eq("id", user.id).maybeSingle(),
  ]);

  const productRows = ((products.data ?? []) as unknown as ProductRow[]).sort(
    (a, b) => (b.product_scores[0]?.score ?? -1) - (a.product_scores[0]?.score ?? -1),
  );
  const taskRows = tasks.data ?? [];
  const queued = taskRows.filter((t) => t.status === "queued" || t.status === "running").length;
  const aiReady = isAdminConfigured() && isGeminiConfigured();
  const isAdmin = me.data?.role === "admin";
  const missing = [
    !isAdminConfigured() && "SUPABASE_SERVICE_ROLE_KEY",
    !isGeminiConfigured() && "GEMINI_API_KEY",
    !process.env.AGENTS_CRON_SECRET && "AGENTS_CRON_SECRET",
    !isMercadoLivreConfigured() && "ML_CLIENT_ID / ML_CLIENT_SECRET (opcional)",
  ].filter(Boolean) as string[];
  const calendar = (strategy.data?.calendar_plan ?? []) as CalendarItem[];
  const flashKey = sp.agentes ? `agentes=${sp.agentes}` : sp.fila ? `fila=${sp.fila}` : null;
  const flash = flashKey ? FLASH[flashKey] : null;

  const info: [string, string][] = [
    ["Objetivo", labelOf(OBJECTIVES, c.objective)],
    ["Mercado", `${labelOf(COUNTRIES, c.market_country)}${c.market_region ? ` · ${c.market_region}` : ""}`],
    ["Idioma", labelOf(LANGUAGES, c.language)],
    ["Nicho", c.niche ?? (c.niche_mode === "ai_discovery" ? "A IA escolhe" : "—")],
    ["Produto", c.product_mode === "ai_discovery" ? "A IA encontra" : c.product_hint],
    ["Tipo de produto", labelOf(PRODUCT_TYPES, c.product_type)],
    ["Plataformas", (c.platforms as string[]).map((p) => labelOf(PLATFORMS, p)).join(", ")],
    ["Tráfego", "Somente orgânico"],
    ["Aprovação", c.approval_required ? "Manual" : "Automática"],
  ];

  return (
    <div className="space-y-6">
      {sp.criada && <Alert tone="success">Campanha criada e ativada. O Product Hunter entrou na fila de trabalho.</Alert>}
      {sp.agentes === "ok" && (
        <Alert tone="success">{Number(sp.n ?? 0) > 0 ? `${sp.n} tarefa(s) processada(s). Veja os resultados abaixo.` : "Nenhuma tarefa pronta para rodar agora."}</Alert>
      )}
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}

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

      <Card className="border-brand-500/30">
        <SectionTitle aside={<Badge tone={queued ? "amber" : "neutral"}>{queued} na fila</Badge>}>Inteligência da campanha</SectionTitle>
        {!aiReady ? (
          <Alert tone="info">
            O processamento de IA está indisponível no momento. As tarefas ficam guardadas na fila e rodam assim que for ativado.
            {isAdmin && missing.length > 0 && <> Variáveis faltando: {missing.join(", ")}.</>}
          </Alert>
        ) : (
          <p className="text-sm text-white/60">
            A fila roda sozinha a cada 2 minutos. Você também pode processar agora.
            {isAdmin && missing.length > 0 && <span className="block text-xs text-white/40">Faltando: {missing.join(", ")}.</span>}
          </p>
        )}
        {c.status === "active" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {aiReady && queued > 0 && (
              <form action={processNow}>
                <input type="hidden" name="campaign_id" value={id} />
                <SubmitButton pendingText="Processando… pode levar até 1 minuto">Processar agora</SubmitButton>
              </form>
            )}
            <form action={rerunAnalysis}>
              <input type="hidden" name="campaign_id" value={id} />
              <SubmitButton variant="secondary" pendingText="Enfileirando…">Refazer análise</SubmitButton>
            </form>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Configuração</SectionTitle>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {info.map(([k, v]) => <div key={k}><dt className="text-white/50">{k}</dt><dd className="text-white">{v}</dd></div>)}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Trabalho da IA nesta campanha</SectionTitle>
          {taskRows.length === 0 ? <EmptyState>Nenhuma tarefa registrada.</EmptyState> : (
            <ul className="space-y-3">
              {taskRows.map((t) => {
                const out = t.output as { summary?: string; needs_input?: boolean } | null;
                return (
                  <li key={t.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white/90">{(t.ai_agents as unknown as { name: string } | null)?.name ?? t.agent_code}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-white/45">{fmt.format(new Date(t.created_at))}</span>
                        <Badge tone={out?.needs_input ? "amber" : t.status === "succeeded" ? "green" : t.status === "failed" ? "red" : t.status === "running" ? "blue" : "amber"}>
                          {out?.needs_input ? "Precisa de você" : TASK_STATUS_LABEL[t.status]}
                        </Badge>
                      </span>
                    </div>
                    {out?.summary && <p className="mt-0.5 text-xs text-white/60">{out.summary}</p>}
                    {t.status === "queued" && t.error && (
                      <p className="mt-0.5 text-xs text-amber-300/80">Tentativa {t.attempts} falhou: {t.error} Próxima após {fmt.format(new Date(t.run_after))}.</p>
                    )}
                    {t.status === "failed" && (
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="text-xs text-red-300/90">{t.error}</p>
                        {c.status === "active" && (
                          <form action={retryTask}>
                            <input type="hidden" name="task_id" value={t.id} />
                            <SubmitButton variant="secondary" className="px-3 py-1 text-xs" pendingText="…">Tentar de novo</SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Decisões da IA</SectionTitle>
          {(decisions.data ?? []).length === 0 ? <EmptyState>Cada decisão aparecerá aqui com justificativa, fontes e confiança.</EmptyState> : (
            <ul className="space-y-3">
              {(decisions.data ?? []).map((d) => {
                const sources = (d.sources ?? []) as { label: string; url?: string | null; quality: string }[];
                return (
                  <li key={d.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                    <p className="font-medium text-white">{d.decision}</p>
                    <p className="mt-0.5 text-xs text-white/60">{d.justification}</p>
                    {sources.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {sources.slice(0, 5).map((s, i) => (
                          <li key={i} className="text-[11px] text-white/45">
                            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/70">{s.label}</a> : s.label}
                            {" · "}{QUALITY[s.quality]?.label ?? s.quality}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[11px] text-white/40">Confiança {Math.round(Number(d.confidence) * 100)}% · {fmt.format(new Date(d.analyzed_at))}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle aside={<span className="text-xs text-white/40">{productRows.length} produto(s)</span>}>Produtos e pontuação</SectionTitle>
        {productRows.length === 0 ? (
          <EmptyState>Nenhum produto ainda. A IA usa apenas produtos reais: do Mercado Livre ou adicionados por você.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/5">
            {productRows.map((p) => {
              const s = p.product_scores[0];
              const origin = p.signals?.origin === "mercadolivre" ? `Mercado Livre${p.signals?.ml_position ? ` · #${p.signals.ml_position} mais vendido` : ""}` : "Informado por você";
              return (
                <li key={p.id} className="flex gap-3 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image_url ? <img src={p.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" loading="lazy" /> : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white">{p.title}</p>
                      {p.selected && <Badge tone="blue">Selecionado</Badge>}
                    </div>
                    <p className="text-xs text-white/50">
                      {origin}
                      {p.price_cents != null && ` · ${brl.format(p.price_cents / 100)}`}
                      {p.commission_rate != null && ` · comissão ${Number(p.commission_rate)}%`}
                      {p.category && ` · ${p.category}`}
                    </p>
                    {s && (
                      <p className="mt-1 text-xs text-white/70">
                        <span className="font-semibold text-white">Pontuação {Number(s.score).toFixed(0)}/100</span>
                        {" · "}confiança {Math.round(Number(s.confidence) * 100)}% · <Badge tone={QUALITY[s.data_quality]?.tone ?? "neutral"}>{QUALITY[s.data_quality]?.label ?? s.data_quality}</Badge>
                        <span className="mt-0.5 block text-white/55">{s.rationale}</span>
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3">
                      {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-400 hover:underline">Abrir produto</a>}
                      {c.status !== "ended" && (
                        <form action={removeProduct}>
                          <input type="hidden" name="product_id" value={p.id} />
                          <input type="hidden" name="campaign_id" value={id} />
                          <button className="text-xs text-white/40 hover:text-red-300">Remover</button>
                        </form>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {c.status !== "ended" && (
          <details className="mt-4 rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-medium text-white">Adicionar produto real</summary>
            <div className="mt-3"><ProductForm campaignId={id} /></div>
          </details>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Público-alvo</SectionTitle>
          {(audiences.data ?? []).length === 0 ? <EmptyState>O público é gerado depois que os produtos forem pontuados.</EmptyState> : (
            <ul className="space-y-4">
              {(audiences.data ?? []).map((a) => {
                const persona = a.persona as { age_range?: string; profile?: string; where_they_are?: string };
                return (
                  <li key={a.id} className="text-sm">
                    <p className="font-medium text-white">{a.name}{persona.age_range ? ` · ${persona.age_range}` : ""}</p>
                    {persona.profile && <p className="text-xs text-white/65">{persona.profile}</p>}
                    <p className="mt-1 text-xs text-white/60"><span className="text-white/80">Dores:</span> {(a.pains as string[]).join("; ")}</p>
                    <p className="text-xs text-white/60"><span className="text-white/80">Interesses:</span> {(a.interests as string[]).join(", ")}</p>
                    {a.buying_intent && <p className="text-xs text-white/60"><span className="text-white/80">Intenção de compra:</span> {a.buying_intent}</p>}
                    {persona.where_they_are && <p className="text-xs text-white/60"><span className="text-white/80">Onde está:</span> {persona.where_they_are}</p>}
                    <p className="mt-1 text-[11px] text-white/40">Inferência da IA · confiança {Math.round(Number(a.confidence ?? 0) * 100)}%</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Estratégia</SectionTitle>
          {!strategy.data ? <EmptyState>A estratégia é gerada depois do público.</EmptyState> : (
            <div className="space-y-2 text-sm">
              <p className="text-white"><span className="text-white/50">v{strategy.data.version} · </span>{strategy.data.positioning}</p>
              <p className="text-xs text-white/60"><span className="text-white/80">Ângulos de venda:</span> {(strategy.data.sales_angles as string[]).join("; ")}</p>
              <p className="text-xs text-white/60"><span className="text-white/80">Formatos:</span> {(strategy.data.formats as string[]).join(", ")}</p>
              {strategy.data.rationale && <p className="text-xs text-white/50">{strategy.data.rationale}</p>}
              <p className="text-[11px] text-white/40">Inferência da IA · confiança {Math.round(Number(strategy.data.confidence ?? 0) * 100)}% · {fmt.format(new Date(strategy.data.created_at))}</p>
            </div>
          )}
        </Card>
      </div>

      {calendar.length > 0 && (
        <Card>
          <SectionTitle>Calendário planejado (14 dias)</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-white/50">
                <tr><th className="py-1.5 pr-3">Dia</th><th className="pr-3">Plataforma</th><th className="pr-3">Formato</th><th className="pr-3">Ângulo</th><th className="pr-3">Produto</th><th>Objetivo</th></tr>
              </thead>
              <tbody className="text-white/80">
                {calendar.map((d, i) => (
                  <tr key={i} className="border-t border-white/5 align-top">
                    <td className="py-1.5 pr-3">{d.day}</td>
                    <td className="pr-3">{labelOf(PLATFORMS, d.platform)}</td>
                    <td className="pr-3">{d.format}</td>
                    <td className="pr-3">{d.angle}</td>
                    <td className="pr-3">{d.product}</td>
                    <td>{d.goal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-white/40">Os roteiros e legendas de cada item serão produzidos na Etapa 3.</p>
        </Card>
      )}

      <Card>
        <SectionTitle>Conteúdos e publicações</SectionTitle>
        {(contents.count ?? 0) === 0 && (posts.data ?? []).length === 0 ? <EmptyState>Nenhum conteúdo produzido ainda.</EmptyState> : (
          <div className="space-y-2 text-sm text-white/85">
            <p>{contents.count ?? 0} conteúdos produzidos</p>
            {(posts.data ?? []).map((p) => <p key={p.id}>{labelOf(PLATFORMS, p.platform)} · {fmt.format(new Date(p.scheduled_for))} · {p.status}</p>)}
          </div>
        )}
      </Card>

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
