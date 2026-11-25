"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { consumeContent } from "../../creative-actions";

export type StudioCreative = {
  id: string;
  day: number | null;
  platform: string;
  platformLabel: string;
  status: "script_ready" | "ready" | "failed";
  hook: string | null;
  scenes: { on_screen: string; speech: string }[];
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  affiliateUrl: string | null;
  audioUrl: string | null;
  productTitle: string | null;
  productImage: string | null;
  videosGenerated: number;
};

const W = 720;
const H = 1280;
const FPS = 30;

function pickMime() {
  const options = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawImageLayer(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, zoom: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!img) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1e1b4b");
    g.addColorStop(1, "#0f766e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return;
  }
  // fundo desfocado (cobre a tela)
  const cover = Math.max(W / img.width, H / img.height) * 1.1;
  ctx.filter = "blur(28px) brightness(0.6)";
  ctx.drawImage(img, (W - img.width * cover) / 2, (H - img.height * cover) / 2, img.width * cover, img.height * cover);
  ctx.filter = "none";
  // foto inteira com zoom lento
  const fit = Math.min((W * 0.92) / img.width, (H * 0.62) / img.height) * zoom;
  const dw = img.width * fit;
  const dh = img.height * fit;
  ctx.drawImage(img, (W - dw) / 2, H * 0.38 - dh / 2, dw, dh);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${size}px system-ui, -apple-system, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text.toUpperCase(), W * 0.86);
  const lh = size * 1.18;
  const top = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineJoin = "round";
    ctx.strokeText(l, W / 2, top + i * lh);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(l, W / 2, top + i * lh);
  });
  ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.save();
  ctx.font = "700 40px system-ui, -apple-system, Roboto, sans-serif";
  const w = Math.min(ctx.measureText(text).width + 64, W * 0.9);
  const x = (W - w) / 2;
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.roundRect(x, y - 38, w, 76, 38);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, y, W * 0.86);
  ctx.restore();
}

function captionText(c: StudioCreative) {
  return [
    c.caption ?? "",
    [c.cta, c.affiliateUrl].filter(Boolean).join(" "),
    c.hashtags.join(" "),
  ].filter((s) => s.trim()).join("\n\n");
}

function CreativeCard({ c }: { c: StudioCreative }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<{ url: string; ext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);

  async function generate() {
    setError(null);
    const mime = pickMime();
    if (mime === null || !("captureStream" in HTMLCanvasElement.prototype)) {
      setError("Este navegador não grava vídeo. Use o Chrome atualizado.");
      return;
    }
    if (!c.audioUrl) {
      setError("A narração ainda não está pronta.");
      return;
    }
    if (files.length === 0 && !c.productImage) {
      setError("Envie pelo menos uma foto do produto.");
      return;
    }
    setBusy(true);
    setProgress(0);
    let wake: { release(): Promise<void> } | null = null;
    let audioCtx: AudioContext | null = null;
    try {
      const allowed = await consumeContent(c.id);
      if (!allowed.ok) throw new Error(allowed.error ?? "Limite atingido.");

      // fotos: as enviadas pelo usuário primeiro, depois a do produto (via proxy, para o canvas poder ser gravado)
      const sources = [
        ...files.map((f) => URL.createObjectURL(f)),
        ...(c.productImage ? [`/api/image-proxy?url=${encodeURIComponent(c.productImage)}`] : []),
      ];
      const images = (await Promise.all(sources.map(loadImage))).filter(Boolean) as HTMLImageElement[];

      audioCtx = new AudioContext();
      await audioCtx.resume();
      const res = await fetch(c.audioUrl);
      if (!res.ok) throw new Error("Não foi possível baixar a narração. Recarregue a página.");
      const buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      const dest = audioCtx.createMediaStreamDestination();
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(dest);

      const canvas = canvasRef.current!;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(FPS);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((r) => { recorder.onstop = () => r(); });

      // tempo de cada cena proporcional ao tamanho da fala
      const total = buffer.duration + 0.6;
      const weights = c.scenes.map((s) => Math.max(s.speech.length, 20));
      const sum = weights.reduce((a, b) => a + b, 0);
      const starts: number[] = [];
      let acc = 0;
      for (const w of weights) { starts.push(acc); acc += (w / sum) * buffer.duration; }

      wake = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } })
        .wakeLock?.request("screen").catch(() => null) ?? null;

      recorder.start(250);
      const t0 = audioCtx.currentTime + 0.05;
      src.start(t0);

      await new Promise<void>((resolve) => {
        const frame = () => {
          const t = Math.max(0, audioCtx!.currentTime - t0);
          let i = starts.length - 1;
          while (i > 0 && t < starts[i]) i--;
          const sceneStart = starts[i];
          const sceneEnd = i + 1 < starts.length ? starts[i + 1] : total;
          const local = (t - sceneStart) / Math.max(sceneEnd - sceneStart, 0.1);
          const img = images.length ? images[i % images.length] : null;
          const fade = Math.min(1, (t - sceneStart) / 0.25);

          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          if (i > 0 && fade < 1) drawImageLayer(ctx, images.length ? images[(i - 1) % images.length] : null, 1.12, 1);
          drawImageLayer(ctx, img, 1 + 0.12 * Math.min(local, 1), i > 0 ? fade : 1);

          const scene = c.scenes[i];
          if (scene) drawText(ctx, scene.on_screen, H * 0.8, i === 0 ? 76 : 66, Math.min(1, fade * 1.5));
          if (i === c.scenes.length - 1 && c.cta) drawPill(ctx, c.cta, H * 0.92);

          // barra de progresso
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(0, 0, W, 8);
          ctx.fillStyle = "#f97316";
          ctx.fillRect(0, 0, W * Math.min(t / total, 1), 8);

          setProgress(Math.min(t / total, 1));
          if (t >= total) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });

      recorder.stop();
      await stopped;
      const type = recorder.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      setVideo((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), ext: type.includes("mp4") ? "mp4" : "webm" };
      });
      sources.filter((s) => s.startsWith("blob:")).forEach((s) => URL.revokeObjectURL(s));
    } catch (e) {
      setError((e as Error).message || "Não foi possível gerar o vídeo.");
    } finally {
      await wake?.release().catch(() => {});
      await audioCtx?.close().catch(() => {});
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(captionText(c));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Segure o texto da legenda para copiar.");
    }
  }

  return (
    <li className="rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">Dia {c.day ?? "?"} · {c.platformLabel}</p>
        <Badge tone={c.status === "ready" ? "green" : c.status === "failed" ? "red" : "amber"}>
          {c.status === "ready" ? "Pronto para vídeo" : c.status === "failed" ? "Falhou" : "Gerando narração"}
        </Badge>
      </div>
      {c.hook && <p className="mt-2 text-sm font-semibold text-brand-300">“{c.hook}”</p>}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-white/60">Roteiro ({c.scenes.length} cenas)</summary>
        <ol className="mt-2 space-y-1.5 text-xs">
          {c.scenes.map((s, i) => (
            <li key={i} className="text-white/75">
              <span className="font-semibold text-white">{i + 1}. {s.on_screen}</span>
              <span className="block text-white/55">{s.speech}</span>
            </li>
          ))}
        </ol>
      </details>

      <p className="mt-2 whitespace-pre-line text-xs text-white/70">{captionText(c)}</p>

      {c.status === "ready" && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-white/60">
            {c.productImage ? "Fotos extras (opcional)" : "Envie fotos do produto"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
              className="mt-1 block w-full text-xs text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate} disabled={busy}>
              {busy ? `Gravando… ${Math.round(progress * 100)}%` : video ? "Gerar de novo" : "Gerar vídeo"}
            </Button>
            <Button variant="secondary" onClick={copy} disabled={!c.caption}>{copied ? "Copiado!" : "Copiar legenda"}</Button>
            {video && (
              <a
                href={video.url}
                download={`organic-ads-dia${c.day ?? ""}-${c.platform}.${video.ext}`}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
              >
                Baixar vídeo
              </a>
            )}
          </div>
          {busy && <p className="text-[11px] text-white/45">Deixe esta tela aberta até terminar. O vídeo é gravado em tempo real.</p>}
          {c.videosGenerated > 0 && !video && <p className="text-[11px] text-white/40">Vídeos já gerados deste roteiro: {c.videosGenerated}</p>}
        </div>
      )}

      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}

      <canvas
        ref={canvasRef}
        className={busy ? "mx-auto mt-3 block aspect-[9/16] w-48 rounded-lg bg-black" : "hidden"}
      />
      {video && !busy && (
        <video src={video.url} controls playsInline className="mx-auto mt-3 aspect-[9/16] w-48 rounded-lg bg-black" />
      )}
    </li>
  );
}

export function CreativeStudio({ creatives }: { creatives: StudioCreative[] }) {
  return (
    <ul className="space-y-3">
      {creatives.map((c) => <CreativeCard key={c.id} c={c} />)}
    </ul>
  );
}
