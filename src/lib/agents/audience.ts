import "server-only";
import { z } from "zod";
import {
  askAI, campaignBrief, clamp01, HONESTY_RULES, recordDecision,
  type AgentContext, type AgentResult,
} from "./context";

const schema = z.object({
  audiences: z.array(z.object({
    name: z.string().min(2).max(120),
    age_range: z.string().max(40),
    profile: z.string().min(5).max(500),
    pains: z.array(z.string().max(200)).min(1).max(8),
    interests: z.array(z.string().max(120)).min(1).max(10),
    buying_intent: z.string().max(300),
    where_they_are: z.string().max(200),
    rationale: z.string().min(10).max(800),
    confidence: z.number().min(0).max(1),
  })).min(1).max(3),
});

/** Audience Intelligence — personas comerciais inferidas pela IA a partir da campanha e dos produtos selecionados. */
export async function audienceIntelligence(ctx: AgentContext): Promise<AgentResult> {
  const c = ctx.campaign;
  const { data: products } = await ctx.db
    .from("products").select("title,category,price_cents").eq("campaign_id", c.id).eq("selected", true).limit(5);

  const ai = await askAI(ctx, {
    system: `Você é estrategista de público para marketing orgânico em redes sociais. ${HONESTY_RULES}`,
    prompt:
      `${campaignBrief(c)}\n\nProdutos selecionados (dados reais): ${JSON.stringify(products ?? [])}\n\n` +
      `Crie de 1 a 3 personas comerciais de quem compraria esses produtos, com dores, interesses, intenção de compra ` +
      `e onde estão (plataformas/contextos). São inferências: explique o raciocínio em "rationale" e use confiança de 0 a 0.7.`,
    schema: {
      type: "OBJECT",
      properties: {
        audiences: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              age_range: { type: "STRING" },
              profile: { type: "STRING" },
              pains: { type: "ARRAY", items: { type: "STRING" } },
              interests: { type: "ARRAY", items: { type: "STRING" } },
              buying_intent: { type: "STRING" },
              where_they_are: { type: "STRING" },
              rationale: { type: "STRING" },
              confidence: { type: "NUMBER" },
            },
            required: ["name", "age_range", "profile", "pains", "interests", "buying_intent", "where_they_are", "rationale", "confidence"],
          },
        },
      },
      required: ["audiences"],
    },
    validator: schema,
  });

  // Substitui as personas anteriores desta campanha pelas novas
  await ctx.db.from("audiences").delete().eq("campaign_id", c.id);
  const rows = ai.audiences.map((a) => ({
    user_id: c.user_id,
    campaign_id: c.id,
    name: a.name,
    persona: { age_range: a.age_range, profile: a.profile, where_they_are: a.where_they_are },
    pains: a.pains,
    interests: a.interests,
    buying_intent: a.buying_intent,
    location: c.market_region ?? c.market_country,
    language: c.language,
    rationale: a.rationale,
    confidence: Math.min(clamp01(a.confidence), 0.7),
  }));
  const { error } = await ctx.db.from("audiences").insert(rows);
  if (error) throw new Error(`Falha ao salvar públicos: ${error.message}`);

  await recordDecision(ctx, {
    decision: `Públicos definidos: ${ai.audiences.map((a) => a.name).join(", ")}`,
    justification: ai.audiences.map((a) => `${a.name}: ${a.rationale}`).join(" | "),
    sources: [{ label: "Inferência do Gemini com base na campanha e nos produtos selecionados", quality: "estimated" }],
    confidence: Math.min(...rows.map((r) => r.confidence)),
  });

  return {
    summary: `${rows.length} persona(s) criada(s).`,
    output: { audiences: rows.map((r) => r.name) },
    next: ["strategy_builder"],
  };
}
