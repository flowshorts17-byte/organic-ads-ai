"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { COUNTRIES, LANGUAGES, OBJECTIVES, PLATFORMS, PRODUCT_TYPES, labelOf } from "@/lib/domain";
import type { CampaignFormState } from "./campaign-actions";

export type CampaignValues = {
  name: string;
  objective: string;
  market_country: string;
  market_region: string;
  language: string;
  niche_mode: "user_defined" | "ai_discovery";
  niche: string;
  product_mode: "user_defined" | "ai_discovery";
  product_hint: string;
  product_type: string;
  platforms: string[];
  organic_only: boolean;
  approval_required: boolean;
};

export const emptyCampaign: CampaignValues = {
  name: "",
  objective: "affiliate_sales",
  market_country: "BR",
  market_region: "",
  language: "pt-BR",
  niche_mode: "ai_discovery",
  niche: "",
  product_mode: "ai_discovery",
  product_hint: "",
  product_type: "any",
  platforms: [],
  organic_only: false,
  approval_required: true,
};

const STEPS = ["Objetivo", "Mercado", "Nicho", "Produto", "Plataformas", "Tráfego", "Confirmar"] as const;

function Choice({ name, value, checked, onChange, title, hint }: {
  name: string; value: string; checked: boolean; onChange: () => void; title: string; hint?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${checked ? "border-brand-400 bg-brand-500/10" : "border-white/10 bg-ink-800/60 hover:border-white/25"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 accent-brand-500" />
      <span>
        <span className="block text-sm font-medium text-white">{title}</span>
        {hint && <span className="block text-xs text-white/55">{hint}</span>}
      </span>
    </label>
  );
}

export function CampaignWizard({
  action,
  initial = emptyCampaign,
  submitLabel,
}: {
  action: (state: CampaignFormState, formData: FormData) => Promise<CampaignFormState>;
  initial?: CampaignValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const [v, setV] = useState<CampaignValues>(initial);
  const [step, setStep] = useState(0);
  const [localError, setLocalError] = useState<string>();
  const set = <K extends keyof CampaignValues>(k: K, val: CampaignValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const fe = state?.fieldErrors ?? {};

  function validate(s: number): string | undefined {
    if (s === 2 && v.niche_mode === "user_defined" && !v.niche.trim()) return "Informe o nicho ou deixe a IA escolher.";
    if (s === 3 && v.product_mode === "user_defined" && !v.product_hint.trim()) return "Informe o produto ou deixe a IA encontrar.";
    if (s === 4 && v.platforms.length === 0) return "Escolha pelo menos uma plataforma.";
    if (s === 5 && !v.organic_only) return "Confirme que a campanha usará apenas tráfego orgânico.";
    if (s === 6 && v.name.trim().length < 2) return "Dê um nome para a campanha.";
    return undefined;
  }
  function next() {
    const err = validate(step);
    setLocalError(err);
    if (!err) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  return (
    <form
      action={formAction}
      className="space-y-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && step < STEPS.length - 1 && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          next();
        }
      }}
    >
      {/* Todos os valores viajam como campos ocultos; as etapas só controlam a exibição. */}
      {(["name","objective","market_country","market_region","language","niche_mode","niche","product_mode","product_hint","product_type"] as const).map((k) => (
        <input key={k} type="hidden" name={k} value={v[k]} />
      ))}
      {v.platforms.map((p) => <input key={p} type="hidden" name="platforms" value={p} />)}
      {v.organic_only && <input type="hidden" name="organic_only" value="on" />}
      {v.approval_required && <input type="hidden" name="approval_required" value="on" />}

      <ol className="flex gap-1.5" aria-label="Progresso">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <span className={`block h-1.5 rounded-full ${i <= step ? "bg-brand-500" : "bg-white/10"}`} />
            <span className={`mt-1.5 hidden text-[11px] sm:block ${i === step ? "text-white" : "text-white/40"}`}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="min-h-64 space-y-3">
        {step === 0 && (
          <>
            <h2 className="text-lg font-semibold text-white">Qual é o objetivo de marketing?</h2>
            {OBJECTIVES.map((o) => (
              <Choice key={o.value} name="_objective" value={o.value} checked={v.objective === o.value}
                onChange={() => set("objective", o.value)} title={o.label} hint={o.hint} />
            ))}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold text-white">Onde está o seu público?</h2>
            <Field label="País">
              <select className={inputClass} value={v.market_country} onChange={(e) => set("market_country", e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Região ou cidade (opcional)" hint="Ex.: Rio Grande do Sul, ou todo o país." error={fe.market_region}>
              <Input value={v.market_region} maxLength={80} onChange={(e) => set("market_region", e.target.value)} />
            </Field>
            <Field label="Idioma do conteúdo">
              <select className={inputClass} value={v.language} onChange={(e) => set("language", e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold text-white">Nicho</h2>
            <Choice name="_niche_mode" value="ai_discovery" checked={v.niche_mode === "ai_discovery"}
              onChange={() => set("niche_mode", "ai_discovery")} title="Deixar a IA encontrar o melhor nicho"
              hint="Os agentes avaliam demanda e concorrência no seu mercado." />
            <Choice name="_niche_mode" value="user_defined" checked={v.niche_mode === "user_defined"}
              onChange={() => set("niche_mode", "user_defined")} title="Escolher meu próprio nicho" />
            {v.niche_mode === "user_defined" && (
              <Field label="Seu nicho" hint="Ex.: pets, fitness, casa e cozinha." error={fe.niche}>
                <Input value={v.niche} maxLength={120} onChange={(e) => set("niche", e.target.value)} autoFocus />
              </Field>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold text-white">Produto</h2>
            <Choice name="_product_mode" value="ai_discovery" checked={v.product_mode === "ai_discovery"}
              onChange={() => set("product_mode", "ai_discovery")} title="Deixar a IA encontrar produtos com potencial"
              hint="Somente fontes autorizadas; números sem verificação são marcados como estimativa." />
            <Choice name="_product_mode" value="user_defined" checked={v.product_mode === "user_defined"}
              onChange={() => set("product_mode", "user_defined")} title="Informar um produto específico" />
            {v.product_mode === "user_defined" && (
              <Field label="Produto (nome ou link)" error={fe.product_hint}>
                <Input value={v.product_hint} maxLength={300} onChange={(e) => set("product_hint", e.target.value)} autoFocus />
              </Field>
            )}
            <Field label="Tipo de produto">
              <select className={inputClass} value={v.product_type} onChange={(e) => set("product_type", e.target.value)}>
                {PRODUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold text-white">Onde divulgar?</h2>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map((p) => {
                const on = v.platforms.includes(p.value);
                return (
                  <label key={p.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${on ? "border-brand-400 bg-brand-500/10 text-white" : "border-white/10 bg-ink-800/60 text-white/80 hover:border-white/25"}`}>
                    <input type="checkbox" className="accent-brand-500" checked={on}
                      onChange={() => set("platforms", on ? v.platforms.filter((x) => x !== p.value) : [...v.platforms, p.value])} />
                    {p.label}
                  </label>
                );
              })}
            </div>
            <Alert>
              A conexão das contas sociais (login oficial de cada rede) será liberada na etapa de automação.
              Até lá, os conteúdos ficam prontos para você publicar manualmente.
            </Alert>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-lg font-semibold text-white">Tráfego orgânico e aprovação</h2>
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-800/60 p-3.5 text-sm text-white/85">
              <input type="checkbox" className="mt-0.5 accent-brand-500" checked={v.organic_only} onChange={(e) => set("organic_only", e.target.checked)} />
              <span>Esta campanha usará <strong className="text-white">exclusivamente tráfego orgânico</strong>: sem anúncios pagos, sem bots e sem interações falsas.</span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-800/60 p-3.5 text-sm text-white/85">
              <input type="checkbox" className="mt-0.5 accent-brand-500" checked={v.approval_required} onChange={(e) => set("approval_required", e.target.checked)} />
              <span>Quero aprovar cada conteúdo antes de ser publicado (recomendado).</span>
            </label>
          </>
        )}

        {step === 6 && (
          <>
            <h2 className="text-lg font-semibold text-white">Confirme a campanha</h2>
            <Field label="Nome da campanha" error={fe.name}>
              <Input value={v.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Achados pet RS" autoFocus />
            </Field>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-ink-800/50 p-4 text-sm sm:grid-cols-2">
              {[
                ["Objetivo", labelOf(OBJECTIVES, v.objective)],
                ["Mercado", `${labelOf(COUNTRIES, v.market_country)}${v.market_region ? ` · ${v.market_region}` : ""}`],
                ["Idioma", labelOf(LANGUAGES, v.language)],
                ["Nicho", v.niche_mode === "ai_discovery" ? "A IA escolhe" : v.niche],
                ["Produto", v.product_mode === "ai_discovery" ? "A IA encontra" : v.product_hint],
                ["Tipo", labelOf(PRODUCT_TYPES, v.product_type)],
                ["Plataformas", v.platforms.map((p) => labelOf(PLATFORMS, p)).join(", ")],
                ["Aprovação", v.approval_required ? "Manual" : "Automática"],
              ].map(([k, val]) => (
                <div key={k}><dt className="text-white/50">{k}</dt><dd className="text-white">{val}</dd></div>
              ))}
            </dl>
          </>
        )}
      </div>

      {(localError || state?.error) && <Alert tone="error">{localError ?? state?.error}</Alert>}

      <div className="flex gap-3">
        {step > 0 && <Button type="button" variant="secondary" onClick={() => { setLocalError(undefined); setStep(step - 1); }}>Voltar</Button>}
        {step < STEPS.length - 1 ? (
          <Button type="button" className="flex-1" onClick={next}>Continuar</Button>
        ) : (
          <SubmitButton className="flex-1" pendingText="Salvando…" onClick={(e) => { const err = validate(6); if (err) { e.preventDefault(); setLocalError(err); } }}>
            {submitLabel}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
