import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { TASK_STATUS_LABEL } from "@/lib/domain";

export type AgentRow = { code: string; name: string; description: string; pipeline_order: number };
export type TaskRow = {
  id: string;
  agent_code: string;
  status: string;
  campaign_id: string | null;
  created_at: string;
  error: string | null;
  campaigns: { name: string; status: string } | null;
};
export type DecisionRow = {
  id: string;
  agent_code: string;
  decision: string;
  justification: string;
  confidence: number;
  sources: unknown;
  analyzed_at: string;
  observed_result: string | null;
};

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const toneFor: Record<string, "neutral" | "blue" | "green" | "amber" | "red"> = {
  queued: "amber", running: "blue", succeeded: "green", failed: "red", canceled: "neutral",
};

/** Seção "MINHA IA DE MARKETING": mostra apenas o que existe no banco — nada é marcado como concluído sem estar. */
export function MyAI({ agents, tasks, decisions }: { agents: AgentRow[]; tasks: TaskRow[]; decisions: DecisionRow[] }) {
  const latestByAgent = new Map<string, TaskRow>();
  for (const t of tasks) if (!latestByAgent.has(t.agent_code)) latestByAgent.set(t.agent_code, t);
  const pending = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const nameOf = (code: string) => agents.find((a) => a.code === code)?.name ?? code;

  return (
    <Card className="border-brand-500/30">
      <SectionTitle aside={<Badge tone="blue">{pending.length} na fila</Badge>}>Minha IA de marketing</SectionTitle>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <h3 className="mb-2 text-xs font-semibold text-white/60">O que a IA está fazendo</h3>
          <ul className="space-y-1.5">
            {agents.map((a) => {
              const t = latestByAgent.get(a.code);
              return (
                <li key={a.code} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-3 py-2">
                  <span className="text-sm text-white/90">{a.pipeline_order}. {a.name}</span>
                  {t ? <Badge tone={toneFor[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge> : <Badge>Sem tarefas</Badge>}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-white/60">Próximos passos</h3>
          {pending.length === 0 ? (
            <EmptyState>Nenhuma tarefa pendente. Crie uma campanha para colocar a IA para trabalhar.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {pending.slice(0, 6).map((t) => {
                const blocked = t.campaigns && t.campaigns.status !== "active";
                return (
                  <li key={t.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                    <p className="text-white">{nameOf(t.agent_code)} · <span className="text-white/60">{t.campaigns?.name ?? "Geral"}</span></p>
                    <p className="text-xs text-white/50">
                      {TASK_STATUS_LABEL[t.status]} desde {fmt.format(new Date(t.created_at))}
                      {blocked ? " · campanha não está ativa, a tarefa aguarda" : " · aguardando o processador de agentes"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-white/60">Decisões tomadas</h3>
          {decisions.length === 0 ? (
            <EmptyState>A IA ainda não tomou decisões. Cada decisão aparecerá aqui com justificativa, fonte e nível de confiança.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {decisions.map((d) => (
                <li key={d.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p className="font-medium text-white">{d.decision}</p>
                  <p className="text-xs text-white/60">{d.justification}</p>
                  <p className="mt-1 text-[11px] text-white/40">
                    {nameOf(d.agent_code)} · confiança {Math.round(Number(d.confidence) * 100)}% · {fmt.format(new Date(d.analyzed_at))}
                    {d.observed_result ? ` · resultado: ${d.observed_result}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
