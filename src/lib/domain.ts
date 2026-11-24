import { z } from "zod";

export const OBJECTIVES = [
  { value: "affiliate_sales", label: "Vendas como afiliado", hint: "Divulgar produtos de terceiros e ganhar comissão." },
  { value: "own_product_sales", label: "Vender meu produto", hint: "Divulgar um produto ou serviço seu." },
  { value: "lead_generation", label: "Gerar contatos", hint: "Atrair pessoas interessadas para uma lista ou WhatsApp." },
  { value: "brand_awareness", label: "Tornar uma marca conhecida", hint: "Alcance e reconhecimento orgânico." },
] as const;

export const COUNTRIES = [
  { value: "BR", label: "Brasil" },
  { value: "PT", label: "Portugal" },
  { value: "US", label: "Estados Unidos" },
  { value: "MX", label: "México" },
  { value: "AR", label: "Argentina" },
] as const;

export const LANGUAGES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "es", label: "Espanhol" },
  { value: "en", label: "Inglês" },
] as const;

export const PRODUCT_TYPES = [
  { value: "physical", label: "Físico" },
  { value: "digital", label: "Digital (cursos, e-books)" },
  { value: "service", label: "Serviço" },
  { value: "any", label: "Qualquer tipo" },
] as const;

export const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
  { value: "facebook", label: "Facebook" },
  { value: "pinterest", label: "Pinterest" },
  { value: "kwai", label: "Kwai" },
  { value: "whatsapp", label: "WhatsApp (status/canal)" },
  { value: "x", label: "X (Twitter)" },
] as const;

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  ended: "Encerrada",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  running: "Executando",
  succeeded: "Concluída",
  failed: "Falhou",
  canceled: "Cancelada",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Aguardando pagamento",
  active: "Ativa",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
  expired: "Expirada",
};

const values = <T extends readonly { value: string }[]>(arr: T) =>
  arr.map((o) => o.value) as unknown as [T[number]["value"], ...T[number]["value"][]];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const campaignSchema = z
  .object({
    name: z.string().trim().min(2, "Dê um nome com pelo menos 2 letras.").max(80),
    objective: z.enum(values(OBJECTIVES)),
    market_country: z.enum(values(COUNTRIES)),
    market_region: optionalText(80),
    language: z.enum(values(LANGUAGES)),
    niche_mode: z.enum(["user_defined", "ai_discovery"]),
    niche: optionalText(120),
    product_mode: z.enum(["user_defined", "ai_discovery"]),
    product_hint: optionalText(300),
    product_type: z.enum(values(PRODUCT_TYPES)),
    platforms: z.array(z.enum(values(PLATFORMS))).min(1, "Escolha pelo menos uma plataforma."),
    organic_only: z.literal(true, { message: "Confirme que a campanha usará apenas tráfego orgânico." }),
    approval_required: z.boolean(),
  })
  .refine((d) => d.niche_mode !== "user_defined" || !!d.niche, {
    message: "Informe o nicho ou deixe a IA escolher.",
    path: ["niche"],
  })
  .refine((d) => d.product_mode !== "user_defined" || !!d.product_hint, {
    message: "Informe o produto ou deixe a IA encontrar.",
    path: ["product_hint"],
  });

export type CampaignInput = z.infer<typeof campaignSchema>;

export function labelOf(list: readonly { value: string; label: string }[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.label ?? value ?? "—";
}
