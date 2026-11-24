"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/app", label: "Painel" },
  { href: "/app/campanhas", label: "Campanhas" },
  { href: "/app/onboarding", label: "Nova campanha" },
  { href: "/app/configuracoes", label: "Conta" },
];

export function NavLinks({ mobile }: { mobile?: boolean }) {
  const path = usePathname();
  return (
    <ul className={mobile ? "grid grid-cols-4 gap-1" : "flex gap-1"}>
      {items.map((i) => {
        const active = i.href === "/app" ? path === "/app" : path.startsWith(i.href);
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-center text-xs font-medium transition sm:text-sm ${
                active ? "bg-brand-500/15 text-brand-300" : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              {i.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
