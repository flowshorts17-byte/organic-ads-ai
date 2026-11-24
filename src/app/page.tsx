import { ButtonLink, Logo } from "@/components/ui";

const steps = [
  ["Pesquisa", "Agentes procuram produtos com sinais reais de demanda em fontes autorizadas."],
  ["Seleção", "Cada produto recebe uma pontuação explicada, separando dado verificado de estimativa."],
  ["Público e estratégia", "Personas, ângulos de venda e calendário de publicação."],
  ["Conteúdo", "Roteiros, legendas e carrosséis adaptados para cada rede."],
  ["Publicação e análise", "Publicação por APIs oficiais e otimização com métricas reais."],
];

export default function Home() {
  return (
    <main className="glow min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Logo />
        <ButtonLink href="/login" variant="secondary">Entrar</ButtonLink>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-12 pt-10 sm:pt-20">
        <p className="text-sm font-medium text-brand-400">Marketing de afiliados 100% orgânico</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
          Uma IA de marketing que pesquisa, planeja e cria suas campanhas.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-white/70">
          Você define o objetivo. Os agentes do ORGANIC ADS AI encontram produtos, identificam o público, montam a
          estratégia e produzem o conteúdo — com sua aprovação, sem tráfego pago e sem prometer resultados que não podem garantir.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/cadastro">Criar conta</ButtonLink>
          <ButtonLink href="/login" variant="secondary">Já tenho conta</ButtonLink>
        </div>
        <p className="mt-4 text-sm text-white/50">Plano Organic Starter: R$ 17,90/mês.</p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-3 px-5 pb-20 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map(([t, d], i) => (
          <div key={t} className="rounded-2xl border border-white/10 bg-ink-900/70 p-4">
            <span className="text-xs font-semibold text-brand-400">0{i + 1}</span>
            <h2 className="mt-1 font-semibold text-white">{t}</h2>
            <p className="mt-1 text-sm text-white/60">{d}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-white/40">
        © {new Date().getFullYear()} ORGANIC ADS AI · Sem bots, sem seguidores falsos · Respeita a LGPD
      </footer>
    </main>
  );
}
