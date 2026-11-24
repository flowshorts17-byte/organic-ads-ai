import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ORGANIC ADS AI", template: "%s · ORGANIC ADS AI" },
  description: "Marketing orgânico autônomo com inteligência artificial.",
};

export const viewport: Viewport = { themeColor: "#05070d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
