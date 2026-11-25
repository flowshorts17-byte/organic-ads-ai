import "server-only";
import { MissingConfigError } from "@/lib/supabase/admin";
import { AIError } from "./gemini";

/**
 * Narração com Gemini TTS (camada gratuita). Modelo: gemini-3.8-flash-lite-tts.
 * Troque com a variável GEMINI_TTS_MODEL. Retorna um WAV (24 kHz, mono, 16-bit).
 */
const API = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const DEFAULT_TTS_VOICE = "Laomedeia"; // "Upbeat": combina com vídeo curto

type InteractionResponse = {
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
  output_audio?: { data?: string };
  error?: { message?: string };
};

export async function generateSpeech(text: string, opts: { style?: string; voice?: string; timeoutMs?: number } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new MissingConfigError("GEMINI_API_KEY");
  const model = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const voice = opts.voice || process.env.GEMINI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(API, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model,
        input: [{
          type: "user_input",
          content: [{
            type: "text",
            text,
            annotations: [{ type: "speech_metadata", style: opts.style ?? "animado e natural, ritmo de vídeo curto, português do Brasil" }],
          }],
        }],
        response_format: { type: "audio", mime_type: "audio/wav" },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
  } catch (e) {
    throw new AIError(`Falha de rede ao gerar narração: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as InteractionResponse;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    throw new AIError(`Gemini TTS recusou a requisição (${res.status}): ${msg}`, res.status === 429 || res.status >= 500);
  }
  let b64 = body.output_audio?.data ?? "";
  if (!b64) {
    for (const step of body.steps ?? []) {
      for (const c of step.content ?? []) if (c.type === "audio" && c.data) b64 = c.data;
    }
  }
  if (!b64) throw new AIError("Gemini TTS não retornou áudio.", true);

  let bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  // Se vier PCM cru (sem cabeçalho RIFF), embrulha em WAV.
  if (!(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) bytes = pcmToWav(bytes, 24_000);
  const seconds = wavSeconds(bytes);
  return { wav: bytes, seconds };
}

function wavSeconds(wav: Uint8Array) {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteRate = v.getUint32(28, true) || 48_000;
  return Math.max(0, (wav.byteLength - 44) / byteRate);
}

function pcmToWav(pcm: Uint8Array, rate: number) {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}
