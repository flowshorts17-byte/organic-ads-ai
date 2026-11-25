import "server-only";
import { z } from "zod";
import { generateSpeech } from "@/lib/ai/tts";
import {
  AgentFatalError, askAI, campaignBrief, HONESTY_RULES, NeedsInputError, notify, recordDecision,
  type AgentContext, type AgentResult,
} from "./context";

type CalendarItem = { day: number; platform: string; format: string; angle: string; product: string; goal: string };
type ProductRow = { id: string; title: string; url: string | null; affiliate_url: string | null; price_cents: number | null; category: string | null };

/** Quantos itens do calendário cada execução trata (cada item = 1 roteiro + 1 narração). */
const ITEMS_PER_RUN = 1;

const scriptSchema = z.object({
  hook: z.string().min(3).max(120),
  scenes: z.array(z.object({
    on_screen: z.string().min(1).max(70),
    speech: z.string().min(1).max(260),
  })).min(4).max(6),
  caption: z.string().min(10).max(1500),
  hashtags: z.array(z.string().max(40)).min(5).max(10),
  cta: z.string().min(3).max(160),
});

/** Creative Generator — roteiro (gancho, cenas, legenda, hashtags, CTA) + narração por item do calendário. */
export async function creativeGenerator(ctx: AgentContext): Promise<AgentResult> {
  const c = ctx.campaign;
  const { data: strategy } = await ctx.db
    .from("strategies").select("id,positioning,calendar_plan,audience_id")
    .eq("campaign_id", c.id).eq("is_current", true).maybeSingle();
  if (!strategy) throw new NeedsInputError("Ainda não há estratégia. O Creative Generator roda depois do Strategy Builder.");

  const calendar = (strategy.calendar_plan ?? []) as CalendarItem[];
  if (calendar.length === 0) throw new NeedsInputError("O calendário da estratégia está vazio.");

  const { data: existing } = await ctx.db
    .from("creatives").select("calendar_index,status").eq("strategy_id", strategy.id);
  const done = new Map((existing ?? []).map((r) => [r.calendar_index as number, r.status as string]));
  const pending = calendar
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => done.get(index) !== "ready" && done.get(index) !== "failed");

  if (pending.length === 0) {
    return { summary: `Todos os ${calendar.length} roteiros já estão prontos.`, output: { total: calendar.length } };
  }

  const [{ data: products }, { data: audience }] = await Promise.all([
    ctx.db.from("products").select("id,title,url,affiliate_url,price_cents,category").eq("campaign_id", c.id).eq("selected", true).limit(10),
    strategy.audience_id
      ? ctx.db.from("audiences").select("name,pains,interests,buying_intent").eq("id", strategy.audience_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let produced = 0;
  for (const { item, index } of pending.slice(0, ITEMS_PER_RUN)) {
    const product = matchProduct((products ?? []) as ProductRow[], item.product);
    const link = product?.affiliate_url || product?.url || null;

    // 1) Roteiro (pula se já existe e só falta a narração)
    let row = done.get(index) === "script_ready"
      ? (await ctx.db.from("creatives").select("*").eq("strategy_id", strategy.id).eq("calendar_index", index).single()).data
      : null;

    if (!row) {
      const ai = await askAI(ctx, {
        system: `Você é roteirista de vídeos curtos verticais (Reels/TikTok) para vendas orgânicas de afiliado. ${HONESTY_RULES}`,
        prompt:
          `${campaignBrief(c)}\n\nPosicionamento: ${strategy.positioning ?? ""}\n` +
          `Público: ${JSON.stringify(audience ?? {})}\n` +
          `Produto: ${JSON.stringify(product ? { title: product.title, price_cents: product.price_cents, category: product.category } : { title: item.product })}\n` +
          `Item do calendário: dia ${item.day}, ${item.platform}, formato "${item.format}", ângulo "${item.angle}", objetivo "${item.goal}".\n\n` +
          `Escreva o roteiro de um vídeo de 15 a 30 segundos (no total, cerca de 45 a 75 palavras faladas):\n` +
          `- "hook": frase do gancho dos 3 primeiros segundos (também é a fala da 1ª cena).\n` +
          `- "scenes": 4 a 6 cenas; "on_screen" = texto curto na tela (até 6 palavras), "speech" = fala da narração. A 1ª cena começa com o gancho e a última termina com a chamada para ação.\n` +
          `- "caption": legenda do post, sem hashtags.\n- "hashtags": 5 a 10, começando com #.\n` +
          `- "cta": chamada para ação curta (ex.: "Link na bio"). Não escreva o link, ele é adicionado depois.\n` +
          `Não prometa resultados nem cite preço, avaliações ou números que não foram fornecidos.`,
        schema: {
          type: "OBJECT",
          properties: {
            hook: { type: "STRING" },
            scenes: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { on_screen: { type: "STRING" }, speech: { type: "STRING" } }, required: ["on_screen", "speech"] },
            },
            caption: { type: "STRING" },
            hashtags: { type: "ARRAY", items: { type: "STRING" } },
            cta: { type: "STRING" },
          },
          required: ["hook", "scenes", "caption", "hashtags", "cta"],
        },
        validator: scriptSchema,
        temperature: 0.7,
      });

      const hashtags = ai.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""));
      const { data: inserted, error } = await ctx.db.from("creatives").upsert({
        user_id: c.user_id,
        campaign_id: c.id,
        strategy_id: strategy.id,
        calendar_index: index,
        product_id: product?.id ?? null,
        platform: item.platform,
        day: item.day,
        status: "script_ready",
        hook: ai.hook,
        scenes: ai.scenes,
        caption: ai.caption,
        hashtags,
        cta: ai.cta,
        affiliate_url: link,
        error: null,
      }, { onConflict: "strategy_id,calendar_index" }).select("*").single();
      if (error) throw new Error(`Falha ao salvar roteiro: ${error.message}`);
      row = inserted;
    }

    // 2) Narração (Gemini TTS, gratuito) -> Supabase Storage
    const scenes = (row.scenes ?? []) as { speech: string }[];
    const narration = scenes.map((s) => s.speech.trim()).join(" ");
    const { data: allowed } = await ctx.db.rpc("consume_ai_requests", { p_user: ctx.task.user_id, p_n: 1 });
    if (!allowed) throw new AgentFatalError("Limite mensal de requisições de IA do plano atingido.");
    const { wav, seconds } = await generateSpeech(narration);

    const path = `${c.user_id}/${c.id}/${row.id}.wav`;
    const up = await ctx.db.storage.from("creatives").upload(path, wav, { contentType: "audio/wav", upsert: true });
    if (up.error) throw new Error(`Falha ao salvar narração: ${up.error.message}`);

    const { error: updErr } = await ctx.db.from("creatives")
      .update({ status: "ready", audio_path: path, audio_seconds: Math.round(seconds * 100) / 100, error: null })
      .eq("id", row.id);
    if (updErr) throw new Error(`Falha ao atualizar criativo: ${updErr.message}`);
    produced++;
  }

  const remaining = pending.length - produced;
  if (remaining === 0) {
    await recordDecision(ctx, {
      decision: `${calendar.length} roteiros com narração prontos`,
      justification: "Roteiros escritos pelo Gemini a partir do calendário, do público e do produto; narração gerada com Gemini TTS. O vídeo é montado no aparelho do usuário.",
      sources: [{ label: "Inferência do Gemini com base na estratégia da campanha", quality: "estimated" }],
      confidence: 0.5,
    });
    await notify(ctx, "Roteiros prontos", `Os ${calendar.length} roteiros da campanha ${c.name} estão prontos. Toque em Gerar vídeo em cada um.`);
  }

  return {
    summary: remaining > 0
      ? `${calendar.length - remaining} de ${calendar.length} roteiros prontos. Continuando…`
      : `${calendar.length} roteiros com narração prontos.`,
    output: { total: calendar.length, remaining },
    next: remaining > 0 ? ["creative_generator"] : [],
  };
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function matchProduct(products: ProductRow[], title: string) {
  if (products.length === 0) return null;
  const t = norm(title);
  return products.find((p) => norm(p.title) === t)
    ?? products.find((p) => norm(p.title).includes(t) || t.includes(norm(p.title)))
    ?? products[0];
}
