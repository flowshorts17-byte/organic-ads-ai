import "server-only";
import { z } from "zod";
import {
  askAI, campaignBrief, clamp01, HONESTY_RULES, notify, recordDecision,
  type AgentContext, type AgentResult,
} from "./context";

const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "pinterest", "kwai", "whatsapp", "x"] as const;

const schema = z.object({
  positioning: z.string().min(10).max(600),
  sales_angles: z.array(z.string().max(200)).min(2).max(8),
  formats: z.array(z.string().max(120)).min(1).max(8),
  calendar: z.array(z.object({
    day: z.number().int().min(1).max(14),
    platform: z.enum(PLATFORMS),
    format: z.string().max(80),
    angle: z.string().max(200),
    product: z.string().max(200),
    goal: z.string().max(160),
  })).min(3).max(28),
  rationale: z.string().min(10).max(1000),
  confidence: z.number().min(0).max(1),
});

/** Strategy Builder — posicionamento, ângulos de venda, formatos e calendário de 14 dias. */
export async function strategyBuilder(ctx: AgentContext): Promise<AgentResult> {
  const c = ctx.campaign;
  const [{ data: products }, { data: audiences }, { data: current }] = await Promise.all([
    ctx.db.from("products").select("id,title,price_cents,category").eq("campaign_id", c.id).eq("selected", true).limit(5),
    ctx.db.from("audiences").select("id,name,pains,interests,buying_intent,persona").eq("campaign_id", c.id),
    ctx.db.from("strategies").select("version").eq("campaign_id", c.id).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const ai = await askAI(ctx, {
    system: `Você é estrategista de conteúdo orgânico para vendas. ${HONESTY_RULES}`,
    prompt:
      `${campaignBrief(c)}\n\nProdutos selecionados: ${JSON.stringify(products ?? [])}\n` +
      `Públicos: ${JSON.stringify(audiences ?? [])}\n\n` +
      `Monte a estratégia: posicionamento, ângulos de venda, formatos e um calendário de 14 dias ` +
      `usando SOMENTE estas plataformas: ${c.platforms.join(", ")}. Em "product" use o título exato de um dos produtos. ` +
      `Explique o raciocínio em "rationale" e use confiança de 0 a 0.7 (ainda não há métricas reais).`,
    schema: {
      type: "OBJECT",
      properties: {
        positioning: { type: "STRING" },
        sales_angles: { type: "ARRAY", items: { type: "STRING" } },
        formats: { type: "ARRAY", items: { type: "STRING" } },
        calendar: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              day: { type: "INTEGER" },
              platform: { type: "STRING", enum: [...c.platforms] },
              format: { type: "STRING" },
              angle: { type: "STRING" },
              product: { type: "STRING" },
              goal: { type: "STRING" },
            },
            required: ["day", "platform", "format", "angle", "product", "goal"],
          },
        },
        rationale: { type: "STRING" },
        confidence: { type: "NUMBER" },
      },
      required: ["positioning", "sales_angles", "formats", "calendar", "rationale", "confidence"],
    },
    validator: schema,
  });

  const calendar = ai.calendar
    .filter((d) => c.platforms.includes(d.platform))
    .sort((a, b) => a.day - b.day);

  await ctx.db.from("strategies").update({ is_current: false }).eq("campaign_id", c.id);
  const confidence = Math.min(clamp01(ai.confidence), 0.7);
  const { error } = await ctx.db.from("strategies").insert({
    user_id: c.user_id,
    campaign_id: c.id,
    audience_id: audiences?.[0]?.id ?? null,
    positioning: ai.positioning,
    sales_angles: ai.sales_angles,
    formats: ai.formats,
    calendar_plan: calendar,
    version: (current?.version ?? 0) + 1,
    is_current: true,
    rationale: ai.rationale,
    confidence,
  });
  if (error) throw new Error(`Falha ao salvar estratégia: ${error.message}`);

  await recordDecision(ctx, {
    decision: `Estratégia v${(current?.version ?? 0) + 1}: ${ai.positioning.slice(0, 200)}`,
    justification: ai.rationale,
    sources: [{ label: "Inferência do Gemini com base nos produtos e públicos da campanha", quality: "estimated" }],
    confidence,
  });
  await notify(ctx, "Estratégia pronta", `A estratégia da campanha ${c.name} foi gerada com calendário de ${calendar.length} publicações.`);

  // Etapa 3: o Creative Generator escreve os roteiros e narrações do calendário.
  return {
    summary: `Estratégia v${(current?.version ?? 0) + 1} com ${calendar.length} itens no calendário.`,
    output: { version: (current?.version ?? 0) + 1, calendar_items: calendar.length },
    next: ["creative_generator"],
  };
}
