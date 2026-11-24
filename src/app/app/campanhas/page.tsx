import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { CAMPAIGN_STATUS_LABEL, OBJECTIVES, PLATFORMS, labelOf } from "@/lib/domain";

export const metadata: Metadata = { title: "Campanhas" };

export default async function CampaignsPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("campaigns")
    .select("id,name,status,objective,platforms,niche,niche_mode,created_at")
    .order("created_at", { ascending: false });
  const camps = data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Campanhas</h1>
        <ButtonLink href="/app/onboarding">Nova campanha</ButtonLink>
      </div>
      {camps.length === 0 ? <EmptyState>Você ainda não criou campanhas.</EmptyState> : (
        <div className="grid gap-3 md:grid-cols-2">
          {camps.map((c) => (
            <Link key={c.id} href={`/app/campanhas/${c.id}`}>
              <Card className="h-full transition hover:border-brand-400/50">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-white">{c.name}</h2>
                  <Badge tone={c.status === "active" ? "green" : c.status === "paused" ? "amber" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-white/60">{labelOf(OBJECTIVES, c.objective)} · {c.niche_mode === "ai_discovery" ? "nicho pela IA" : c.niche}</p>
                <p className="mt-2 text-xs text-white/45">{(c.platforms as string[]).map((p) => labelOf(PLATFORMS, p)).join(" · ")}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
