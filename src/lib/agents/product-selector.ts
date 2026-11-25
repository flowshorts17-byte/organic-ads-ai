import "server-only";
import { z } from "zod";
import {
  AgentFatalError, askAI, campaignBrief, HONESTY_RULES, recordDecision,
  type AgentContext, type AgentResult,
} from "./context";
import { computeScore } from "./scoring";

type ProductRow = {
  id: string;
  title: string;
  url: string | null;
  price_cents: number | null;
  commission_rate: number | null;
  rating: number | null;
  reviews_count: number | null;
  category: string | null;
  data_quality: string;
  signals: Record<string, unknown>;
};

const aiSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    competition: z.number().min(0).max(100),
    fit: z.number().min(0).max(100),
    rationale: z.string().min(5).max(600),
  })),
});

/**
 * Product Selector — pontua cada produto (0 a 100) combinando:
 * - sinais VERIFICADOS (posição nos mais vendidos do ML, comissão e avaliações quando informadas);
 * - sinais ESTIMADOS pela IA (saturação/concorrência e aderência à campanha), sempre marcados como estimados.
 * Seleciona os 3 melhores.
 */
export async function productSelector(ctx: AgentContext): Promise<AgentResult> {
  const c = ctx.campaign;
  const { data, error } = await ctx.db
    .from("products")
    .select("id,title,url,price_cents,commission_rate,rating,reviews_count,category,data_quality,signals")
    .eq("campaign_id", c.id)
    .order("fetched_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Falha ao ler produtos: ${error.message}`);
  const products = (data ?? []) as ProductRow[];
  if (products.length === 0) throw new AgentFatalError("Não há produtos para pontuar nesta campanha.");

  const list = products.map((p) => ({
    id: p.id,
    titulo: p.title,
    categoria: p.category,
    preco: p.price_cents != null ? (p.price_cents / 100).toFixed(2) : null,
    comissao_pct: p.commission_rate,
    posicao_mais_vendidos_ml: (p.signals?.ml_position as number | undefined) ?? null,
  }));

  const ai = await askAI(ctx, {
    system: `Você avalia oportunidades de divulgação orgânica de produtos. ${HONESTY_RULES}`,
    prompt:
      `${campaignBrief(c)}\n\nProdutos (dados reais coletados):\n${JSON.stringify(list)}\n\n` +
      `Para CADA produto, devolva pelo id:\n` +
      `- competition: 0 a 100, onde 100 = pouca saturação de conteúdo orgânico (boa oportunidade) e 0 = mercado saturado. É uma estimativa sua.\n` +
      `- fit: 0 a 100, aderência ao objetivo, público e plataformas da campanha.\n` +
      `- rationale: 1 ou 2 frases explicando, sem inventar números.`,
    schema: {
      type: "OBJECT",
      properties: {
        products: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              competition: { type: "NUMBER" },
              fit: { type: "NUMBER" },
              rationale: { type: "STRING" },
            },
            required: ["id", "competition", "fit", "rationale"],
          },
        },
      },
      required: ["products"],
    },
    validator: aiSchema,
    temperature: 0.2,
  });
  const aiById = new Map(ai.products.map((p) => [p.id, p]));

  const scored = products.map((p) => {
    const est = aiById.get(p.id);
    const result = computeScore({
      mlPosition: (p.signals?.ml_position as number | undefined) ?? null,
      commissionRate: p.commission_rate != null ? Number(p.commission_rate) : null,
      rating: p.rating != null ? Number(p.rating) : null,
      reviewsCount: p.reviews_count,
      aiCompetition: est?.competition ?? null,
      aiFit: est?.fit ?? null,
    });
    return { p, est, result };
  });

  for (const s of scored) {
    const { error: e } = await ctx.db.from("product_scores").insert({
      user_id: c.user_id,
      product_id: s.p.id,
      score: s.result.score,
      demand_signal: s.result.signals.demand,
      commission_signal: s.result.signals.commission,
      competition_signal: s.result.signals.competition,
      reviews_signal: s.result.signals.reviews,
      rationale: (s.est?.rationale ?? "Sem avaliação da IA para este produto; pontuação só com sinais verificados.").slice(0, 1000),
      confidence: s.result.confidence,
      data_quality: s.result.dataQuality,
      breakdown: s.result.breakdown,
    });
    if (e) throw new Error(`Falha ao salvar pontuação: ${e.message}`);
  }

  const ranked = [...scored].sort((a, b) => b.result.score - a.result.score);
  const top = ranked.slice(0, 3);
  await ctx.db.from("products").update({ selected: false }).eq("campaign_id", c.id);
  await ctx.db.from("products").update({ selected: true }).in("id", top.map((t) => t.p.id));

  await recordDecision(ctx, {
    decision: `Produtos selecionados: ${top.map((t) => `${t.p.title.slice(0, 60)} (${t.result.score})`).join("; ")}`,
    justification:
      "Pontuação = média ponderada dos sinais disponíveis: demanda (posição nos mais vendidos, verificada), " +
      "concorrência e aderência (estimadas pela IA), comissão e avaliações (quando informadas). " +
      top.map((t) => `${t.p.title.slice(0, 40)}: ${t.est?.rationale ?? "sem avaliação da IA"}`).join(" | "),
    sources: top.map((t) => ({ label: t.p.title.slice(0, 120), url: t.p.url, quality: t.result.dataQuality })),
    confidence: top.reduce((s, t) => s + t.result.confidence, 0) / top.length,
  });

  return {
    summary: `${products.length} produtos pontuados; ${top.length} selecionados.`,
    output: { scored: products.length, selected: top.map((t) => ({ id: t.p.id, score: t.result.score })) },
    next: ["audience_intelligence"],
  };
}
