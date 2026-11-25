import "server-only";
import { z } from "zod";
import { isGeminiConfigured } from "@/lib/ai/gemini";
import {
  isMercadoLivreConfigured, mlAppToken, mlBestSellers, mlDiscoverCategory, mlSiteFor,
} from "@/lib/sources/mercadolivre";
import {
  askAI, campaignBrief, HONESTY_RULES, NeedsInputError, notify, recordDecision,
  type AgentContext, type AgentResult,
} from "./context";

const nicheSchema = z.object({
  niche: z.string().min(2).max(120),
  search_term: z.string().min(2).max(80),
  justification: z.string().min(10).max(800),
  confidence: z.number().min(0).max(1),
});

async function sourceId(ctx: AgentContext, code: string) {
  const { data } = await ctx.db.from("product_sources").select("id").eq("code", code).single();
  if (!data) throw new Error(`Fonte ${code} não cadastrada.`);
  return data.id as string;
}

/**
 * Product Hunter — encontra produtos REAIS:
 * 1) produto informado pelo usuário na campanha;
 * 2) mais vendidos da categoria no Mercado Livre (API oficial), para produtos físicos.
 * Se o nicho for "a IA escolhe", o Gemini sugere o nicho (registrado como decisão, com justificativa),
 * mas os produtos só entram se vierem de uma fonte real.
 */
export async function productHunter(ctx: AgentContext): Promise<AgentResult> {
  const c = ctx.campaign;
  const notes: string[] = [];
  let found = 0;

  // 1) Produto indicado pelo usuário
  if (c.product_mode === "user_defined" && c.product_hint) {
    const hint = c.product_hint.trim();
    const isUrl = /^https:\/\/\S+$/i.test(hint);
    const { error } = await ctx.db.from("products").upsert(
      {
        user_id: c.user_id,
        campaign_id: c.id,
        source_id: await sourceId(ctx, "manual"),
        external_id: `campaign:${c.id}`,
        title: isUrl ? `Produto informado: ${new URL(hint).hostname}` : hint.slice(0, 300),
        url: isUrl ? hint : null,
        data_quality: "indirect",
        signals: { origin: "user" },
      },
      { onConflict: "user_id,source_id,external_id" },
    );
    if (error) throw new Error(`Falha ao salvar produto informado: ${error.message}`);
    found++;
    notes.push("Produto informado por você registrado.");
  }

  // 2) Termo de busca: produto > nicho > sugestão da IA
  let term: string | null = null;
  if (c.product_mode === "user_defined" && c.product_hint && !/^https:\/\//i.test(c.product_hint)) term = c.product_hint;
  else if (c.niche_mode === "user_defined" && c.niche) term = c.niche;
  else if (c.niche_mode === "ai_discovery" && isGeminiConfigured()) {
    const ai = await askAI(ctx, {
      system: `Você é um analista de marketing de afiliados. ${HONESTY_RULES}`,
      prompt:
        `${campaignBrief(c)}\n\nSugira UM nicho promissor para essa campanha e um termo curto de busca ` +
        `(2 a 4 palavras, no idioma do mercado) para procurar produtos desse nicho num marketplace. ` +
        `Justifique em até 3 frases, deixando claro que é uma inferência. Confiança entre 0 e 0.6.`,
      schema: {
        type: "OBJECT",
        properties: {
          niche: { type: "STRING" },
          search_term: { type: "STRING" },
          justification: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: ["niche", "search_term", "justification", "confidence"],
      },
      validator: nicheSchema,
    });
    term = ai.search_term;
    await recordDecision(ctx, {
      decision: `Nicho sugerido pela IA: ${ai.niche}`,
      justification: `${ai.justification} (Sugestão da IA, ainda não validada por dados de vendas.)`,
      sources: [{ label: "Inferência do modelo Gemini a partir da configuração da campanha", quality: "estimated" }],
      confidence: Math.min(ai.confidence, 0.6),
    });
    await ctx.db.from("campaigns").update({ niche: ai.niche.slice(0, 120) }).eq("id", c.id);
    notes.push(`Nicho sugerido pela IA: ${ai.niche}.`);
  }

  // 3) Mercado Livre (somente produtos físicos e países com site do ML)
  const site = mlSiteFor(c.market_country);
  const physicalOk = c.product_type === "physical" || c.product_type === "any";
  if (term && site && physicalOk && isMercadoLivreConfigured()) {
    const category = await mlDiscoverCategory(site, term);
    if (!category) {
      notes.push(`O Mercado Livre não encontrou categoria para "${term}".`);
    } else {
      const token = await mlAppToken();
      const items = await mlBestSellers(site, category.categoryId, token, 8);
      const mlSource = await sourceId(ctx, "mercadolivre");
      for (const p of items) {
        const { error } = await ctx.db.from("products").upsert(
          {
            user_id: c.user_id,
            campaign_id: c.id,
            source_id: mlSource,
            external_id: p.externalId,
            title: p.title,
            url: p.url,
            image_url: p.imageUrl,
            price_cents: p.priceCents,
            currency: p.currency ?? "BRL",
            category: category.categoryName.slice(0, 120),
            data_quality: "verified",
            signals: { origin: "mercadolivre", ml_position: p.position, ml_category_id: category.categoryId, ml_kind: p.kind },
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "user_id,source_id,external_id" },
        );
        if (error) throw new Error(`Falha ao salvar produto do Mercado Livre: ${error.message}`);
      }
      found += items.length;
      notes.push(`${items.length} mais vendidos de "${category.categoryName}" no Mercado Livre.`);
      if (items.length > 0) {
        await recordDecision(ctx, {
          decision: `Coletados ${items.length} mais vendidos da categoria ${category.categoryName}`,
          justification: `Termo de busca "${term}" mapeado para a categoria ${category.categoryName} (${category.categoryId}). ` +
            `A lista de mais vendidos é oficial do Mercado Livre; preços são os do momento da coleta.`,
          sources: items.slice(0, 8).map((p) => ({ label: `#${p.position} ${p.title}`, url: p.url, quality: "verified" })),
          confidence: 0.85,
        });
      }
    }
  } else if (term && physicalOk && site && !isMercadoLivreConfigured()) {
    notes.push("Mercado Livre não configurado (ML_CLIENT_ID e ML_CLIENT_SECRET).");
  } else if (!physicalOk) {
    notes.push("Produtos digitais e serviços ainda não têm fonte automática: adicione os seus manualmente.");
  }

  // Também contam produtos que o usuário já adicionou manualmente
  const { count } = await ctx.db.from("products").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
  const total = count ?? found;

  if (total === 0) {
    const msg = "Nenhum produto real encontrado. Adicione produtos na página da campanha (link, preço e comissão) " +
      "ou configure o Mercado Livre para a busca automática.";
    await notify(ctx, "A IA precisa de produtos reais", msg);
    throw new NeedsInputError(msg, { notes });
  }

  return {
    summary: notes.join(" ") || `${total} produtos na campanha.`,
    output: { products_total: total, found_now: found, search_term: term, notes },
    next: ["product_selector"],
  };
}
