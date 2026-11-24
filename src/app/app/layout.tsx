import Link from "next/link";
import { Logo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signOut } from "../(auth)/actions";
import { NavLinks } from "./nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  return (
    <div className="min-h-dvh bg-ink-950 pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/app"><Logo /></Link>
          <nav className="hidden md:block"><NavLinks /></nav>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-40 truncate text-xs text-white/50 sm:inline">{user.email}</span>
            <form action={signOut}>
              <button className="rounded-lg px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-2 py-2 backdrop-blur md:hidden">
        <NavLinks mobile />
      </nav>
    </div>
  );
}
