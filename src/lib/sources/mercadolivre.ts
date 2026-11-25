import "server-only";

/**
 * Mercado Livre — API oficial (https://developers.mercadolivre.com.br).
 * - domain_discovery: público, descobre a categoria a partir de um termo.
 * - highlights (mais vendidos por categoria) e products: exigem token de aplicativo
 *   (grant client_credentials com ML_CLIENT_ID e ML_CLIENT_SECRET, gratuito).
 * Todos os dados retornados aqui vêm da API oficial: nada é estimado.
 */
const API = "https://api.mercadolibre.com";
const SITE_BY_COUNTRY: Record<string, string> = { BR: "MLB", MX: "MLM", AR: "MLA" };

export function mlSiteFor(country: string) {
  return SITE_BY_COUNTRY[country] ?? null;
}

export function isMercadoLivreConfigured() {
  return Boolean(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET);
}

export class SourceError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "SourceError";
  }
}

async function getJSON<T>(url: string, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  } catch (e) {
    throw new SourceError(`Mercado Livre indisponível: ${(e as Error).message}`, true);
  }
  if (!res.ok) {
    throw new SourceError(`Mercado Livre respondeu ${res.status} em ${new URL(url).pathname}`, res.status === 429 || res.status >= 500);
  }
  return (await res.json()) as T;
}

export async function mlAppToken(): Promise<string> {
  const id = process.env.ML_CLIENT_ID;
  const secret = process.env.ML_CLIENT_SECRET;
  if (!id || !secret) throw new SourceError("Mercado Livre não configurado.", false);
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; message?: string };
  if (!res.ok || !body.access_token) {
    throw new SourceError(`Não foi possível autenticar no Mercado Livre: ${body.message ?? res.status}`, res.status >= 500);
  }
  return body.access_token;
}

export type MLCategory = { categoryId: string; categoryName: string; domainName: string };

export async function mlDiscoverCategory(site: string, query: string): Promise<MLCategory | null> {
  const rows = await getJSON<{ category_id: string; category_name: string; domain_name: string }[]>(
    `${API}/sites/${site}/domain_discovery/search?limit=1&q=${encodeURIComponent(query)}`,
  );
  const r = rows[0];
  return r ? { categoryId: r.category_id, categoryName: r.category_name, domainName: r.domain_name } : null;
}

export type MLProduct = {
  externalId: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  position: number;
  kind: "product" | "item";
};

type Highlights = { content?: { id: string; position: number; type: string }[] };
type CatalogProduct = {
  id: string;
  name?: string;
  permalink?: string;
  pictures?: { url?: string; secure_url?: string }[];
  buy_box_winner?: { price?: number; currency_id?: string } | null;
};
type Item = { id: string; title?: string; permalink?: string; thumbnail?: string; secure_thumbnail?: string; price?: number; currency_id?: string };

const toCents = (v: number | undefined | null) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const https = (u: string | undefined | null) => (u ? u.replace(/^http:\/\//, "https://") : null);

/** Mais vendidos da categoria (lista oficial do ML), com nome, link, foto e preço atual. */
export async function mlBestSellers(site: string, categoryId: string, token: string, limit = 8): Promise<MLProduct[]> {
  const hl = await getJSON<Highlights>(`${API}/highlights/${site}/category/${encodeURIComponent(categoryId)}`, token);
  const top = (hl.content ?? []).sort((a, b) => a.position - b.position).slice(0, limit);

  const out = await Promise.all(
    top.map(async (h): Promise<MLProduct | null> => {
      try {
        if (h.type === "PRODUCT") {
          const p = await getJSON<CatalogProduct>(`${API}/products/${encodeURIComponent(h.id)}`, token);
          if (!p.name) return null;
          return {
            externalId: p.id,
            title: p.name.slice(0, 300),
            url: https(p.permalink) ?? null,
            imageUrl: https(p.pictures?.[0]?.secure_url ?? p.pictures?.[0]?.url),
            priceCents: toCents(p.buy_box_winner?.price),
            currency: p.buy_box_winner?.currency_id ?? null,
            position: h.position,
            kind: "product",
          };
        }
        const it = await getJSON<Item>(`${API}/items/${encodeURIComponent(h.id)}`, token);
        if (!it.title) return null;
        return {
          externalId: it.id,
          title: it.title.slice(0, 300),
          url: https(it.permalink),
          imageUrl: https(it.secure_thumbnail ?? it.thumbnail),
          priceCents: toCents(it.price),
          currency: it.currency_id ?? null,
          position: h.position,
          kind: "item",
        };
      } catch {
        return null; // um item indisponível não derruba a lista
      }
    }),
  );
  return out.filter((p): p is MLProduct => p !== null);
}
