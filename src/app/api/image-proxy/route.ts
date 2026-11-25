import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Busca a foto do produto no servidor para o navegador desenhar no canvas sem "contaminar"
 * (canvas de outra origem não pode ser gravado). Só para usuários logados, só imagens, até 8 MB.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("não autorizado", { status: 401 });

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("url inválida", { status: 400 });
  }
  if (target.protocol !== "https:") return new Response("só https", { status: 400 });

  const res = await fetch(target.toString(), { headers: { accept: "image/*" }, redirect: "follow" }).catch(() => null);
  if (!res || !res.ok) return new Response("imagem indisponível", { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return new Response("não é imagem", { status: 415 });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 8_000_000) return new Response("imagem grande demais", { status: 413 });

  const body = await res.arrayBuffer();
  if (body.byteLength > 8_000_000) return new Response("imagem grande demais", { status: 413 });
  return new Response(body, {
    headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
