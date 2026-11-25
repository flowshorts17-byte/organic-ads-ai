import "server-only";
import type { z } from "zod";
import { MissingConfigError } from "@/lib/supabase/admin";

/**
 * Cliente mínimo da API Gemini (Google AI Studio, camada gratuita).
 * Modelo padrão: gemini-3.5-flash-lite (maior cota gratuita: ~10 req/min, ~500 req/dia).
 * Troque com a variável GEMINI_MODEL sem mudar código.
 */
const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export class AIError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "AIError";
  }
}

/** Esquema no formato OpenAPI aceito por `responseSchema` do Gemini. */
export type GeminiSchema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
  nullable?: boolean;
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

/**
 * Gera JSON estruturado e valida com zod. Nada é aceito sem passar pela validação.
 */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: GeminiSchema;
  validator: z.ZodType<T>;
  temperature?: number;
  timeoutMs?: number;
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new MissingConfigError("GEMINI_API_KEY");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 40_000);
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.4,
          responseMimeType: "application/json",
          responseSchema: opts.schema,
        },
      }),
    });
  } catch (e) {
    throw new AIError(`Falha de rede ao chamar o Gemini: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    // 429 = limite gratuito por minuto/dia; 5xx = instabilidade. Ambos podem ser tentados de novo.
    throw new AIError(`Gemini recusou a requisição (${res.status}): ${msg}`, res.status === 429 || res.status >= 500);
  }
  if (body.promptFeedback?.blockReason) {
    throw new AIError(`Gemini bloqueou o pedido: ${body.promptFeedback.blockReason}`, false);
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AIError("Gemini não retornou conteúdo.", true);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AIError("Gemini retornou um JSON inválido.", true);
  }
  const parsed = opts.validator.safeParse(json);
  if (!parsed.success) {
    throw new AIError(`Resposta do Gemini fora do formato esperado: ${parsed.error.issues[0]?.message ?? ""}`, true);
  }
  return parsed.data;
}
