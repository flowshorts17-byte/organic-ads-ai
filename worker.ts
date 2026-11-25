// Entrada personalizada do Worker: serve o app Next.js (OpenNext) e adiciona o Cron Trigger
// que processa a fila de agentes. Ver https://opennext.js.org/cloudflare/howtos/custom-worker
// @ts-expect-error -- gerado no build por `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";

type Env = { AGENTS_CRON_SECRET?: string };
type Ctx = { waitUntil(p: Promise<unknown>): void };

export default {
  fetch: handler.fetch,
  async scheduled(_event: unknown, env: Env, ctx: Ctx) {
    if (!env.AGENTS_CRON_SECRET) return;
    const req = new Request("https://cron.internal/api/agents/run", {
      method: "POST",
      headers: { "x-cron-secret": env.AGENTS_CRON_SECRET },
    });
    ctx.waitUntil(handler.fetch(req, env, ctx));
  },
};

// @ts-expect-error -- reexporta Durable Objects do OpenNext (se usados)
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
