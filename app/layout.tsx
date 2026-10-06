import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Happy Order System",
  description: "Proforma invoice, booking, accounting, costing and commission workflow.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hans"><body>{children}</body></html>;
}
