import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { headers } from "next/headers";
import { Shell } from "@/components/Shell";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

const body = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
});

export const metadata: Metadata = {
  title: "OYOI — Restaurant SMS Ops",
  description: "Text your restaurant. Inventory, suppliers, and memory that compounds.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const path = h.get("x-pathname") || h.get("x-url") || "";
  // Fallback: supplier is detected client-side via a marker; use middleware path header when present
  const isSupplier = path.includes("/supplier");

  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body
        className="min-h-full"
        style={
          {
            ["--font-display" as string]: "var(--font-fraunces), Georgia, serif",
            ["--font-body" as string]: "var(--font-source), 'Segoe UI', sans-serif",
          } as React.CSSProperties
        }
      >
        {isSupplier ? children : <Shell>{children}</Shell>}
      </body>
    </html>
  );
}
