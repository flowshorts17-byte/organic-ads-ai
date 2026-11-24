import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight text-white", className)}>
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-xs font-bold">OA</span>
      ORGANIC ADS <span className="text-brand-400">AI</span>
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-lg shadow-black/20", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">{children}</h2>
      {aside}
    </div>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50";
const variants = {
  primary: "bg-brand-500 text-white hover:bg-brand-600",
  secondary: "border border-white/15 bg-white/5 text-white hover:bg-white/10",
  danger: "border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-white/90">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-white/50">{hint}</span>}
      {error && <span className="block text-xs text-red-300">{error}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const tones = {
    info: "border-brand-400/30 bg-brand-500/10 text-brand-300",
    error: "border-red-400/30 bg-red-500/10 text-red-200",
    success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  };
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "blue" | "green" | "amber" | "red"; children: ReactNode }) {
  const tones = {
    neutral: "bg-white/10 text-white/80",
    blue: "bg-brand-500/15 text-brand-300",
    green: "bg-emerald-500/15 text-emerald-300",
    amber: "bg-amber-500/15 text-amber-300",
    red: "bg-red-500/15 text-red-300",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-white/50">{children}</p>;
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-4">
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
