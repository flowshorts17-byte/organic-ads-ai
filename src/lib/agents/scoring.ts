/**
 * Pontuação de oportunidade (0 a 100). Função pura, testável.
 * Cada sinal é 0–100. Sinais ausentes NÃO viram zero nem são inventados: saem da média e reduzem a confiança.
 */
export type ScoreInput = {
  mlPosition: number | null; // posição na lista oficial de mais vendidos (1 = mais vendido)
  commissionRate: number | null; // % de comissão informada
  rating: number | null; // 0–5
  reviewsCount: number | null;
  aiCompetition: number | null; // estimativa da IA (100 = pouca saturação)
  aiFit: number | null; // estimativa da IA (aderência à campanha)
};

export const WEIGHTS = { demand: 0.35, competition: 0.2, fit: 0.15, commission: 0.2, reviews: 0.1 } as const;

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function computeScore(i: ScoreInput) {
  const demand = i.mlPosition != null && i.mlPosition >= 1 ? clamp(100 - (i.mlPosition - 1) * 5) : null;
  const commission = i.commissionRate != null ? clamp(i.commissionRate * 5) : null; // 20% ou mais = 100
  const reviews =
    i.rating != null && i.reviewsCount != null
      ? clamp((i.rating / 5) * 70 + Math.min(30, Math.log10(i.reviewsCount + 1) * 10))
      : null;
  const competition = i.aiCompetition != null ? clamp(i.aiCompetition) : null;
  const fit = i.aiFit != null ? clamp(i.aiFit) : null;

  const parts: { key: keyof typeof WEIGHTS; value: number; verified: boolean }[] = [];
  if (demand != null) parts.push({ key: "demand", value: demand, verified: true });
  if (commission != null) parts.push({ key: "commission", value: commission, verified: true });
  if (reviews != null) parts.push({ key: "reviews", value: reviews, verified: true });
  if (competition != null) parts.push({ key: "competition", value: competition, verified: false });
  if (fit != null) parts.push({ key: "fit", value: fit, verified: false });

  const totalWeight = parts.reduce((s, p) => s + WEIGHTS[p.key], 0);
  const score = totalWeight > 0 ? parts.reduce((s, p) => s + p.value * WEIGHTS[p.key], 0) / totalWeight : 0;

  const verifiedWeight = parts.filter((p) => p.verified).reduce((s, p) => s + WEIGHTS[p.key], 0);
  // Confiança: 0.2 de base + proporção do peso total (1.0) coberta por sinais verificados (até 0.6) e estimados (até 0.15)
  const estimatedWeight = totalWeight - verifiedWeight;
  const confidence = parts.length === 0 ? 0 : Math.min(0.95, 0.2 + verifiedWeight * 0.6 / 0.65 + estimatedWeight * 0.15 / 0.35);

  const dataQuality: "verified" | "estimated" | "indirect" =
    parts.length === 0 ? "indirect" : verifiedWeight === totalWeight ? "verified" : "estimated";

  return {
    score: round(clamp(score)),
    confidence: round(Math.min(1, confidence)),
    dataQuality,
    signals: {
      demand: demand != null ? round(demand) : null,
      commission: commission != null ? round(commission) : null,
      reviews: reviews != null ? round(reviews) : null,
      competition: competition != null ? round(competition) : null,
    },
    breakdown: Object.fromEntries(
      parts.map((p) => [p.key, { value: round(p.value), weight: WEIGHTS[p.key], verified: p.verified }]),
    ),
  };
}
