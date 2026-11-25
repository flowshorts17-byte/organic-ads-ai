// Testes da pontuação de oportunidade (função pura). Node 22+ executa TypeScript direto.
import { computeScore } from "../src/lib/agents/scoring.ts";

let passed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log("  ✔", name); }
  else { console.error("  ✘", name, extra); process.exitCode = 1; }
};

const none = { mlPosition: null, commissionRate: null, rating: null, reviewsCount: null, aiCompetition: null, aiFit: null };

const empty = computeScore(none);
ok("sem nenhum sinal: pontuação 0, confiança 0, dado indireto", empty.score === 0 && empty.confidence === 0 && empty.dataQuality === "indirect");

const top1 = computeScore({ ...none, mlPosition: 1 });
ok("1º mais vendido sozinho = 100 e dado verificado", top1.score === 100 && top1.dataQuality === "verified");

const p20 = computeScore({ ...none, mlPosition: 20 });
ok("20º mais vendido = 5", p20.score === 5, JSON.stringify(p20));

const mixed = computeScore({ ...none, mlPosition: 3, aiCompetition: 40, aiFit: 80 });
ok("com estimativa da IA o dado vira 'estimado'", mixed.dataQuality === "estimated");
const expected = (90 * 0.35 + 40 * 0.2 + 80 * 0.15) / (0.35 + 0.2 + 0.15);
ok("média ponderada só dos sinais disponíveis", Math.abs(mixed.score - expected) < 0.01, `${mixed.score} vs ${expected}`);

const aiOnly = computeScore({ ...none, aiCompetition: 90, aiFit: 90 });
ok("só estimativa da IA: confiança baixa (< 0,4)", aiOnly.confidence < 0.4, String(aiOnly.confidence));
ok("mais sinais verificados = mais confiança", computeScore({ ...none, mlPosition: 1, commissionRate: 15, rating: 4.5, reviewsCount: 300 }).confidence > top1.confidence);

const commission = computeScore({ ...none, commissionRate: 30 });
ok("comissão acima de 20% é limitada a 100", commission.signals.commission === 100);
ok("sinal ausente fica null (não vira zero)", mixed.signals.commission === null && mixed.signals.reviews === null);
ok("pontuação sempre entre 0 e 100", [empty, top1, p20, mixed, aiOnly, commission].every((r) => r.score >= 0 && r.score <= 100));

console.log(`\n${passed} verificações passaram${process.exitCode ? " — HÁ FALHAS" : ""}.`);
