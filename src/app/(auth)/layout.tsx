import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="glow flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <Link href="/" className="mb-8"><Logo /></Link>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-900/90 p-6 shadow-2xl shadow-black/40">
        {children}
      </div>
    </main>
  );
}
