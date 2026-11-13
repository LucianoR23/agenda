import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { THEME_BOOT } from "@/ui/theme";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Agenda",
  description: "Tareas, recordatorios y eventos, con Sunday.",
  appleWebApp: { capable: true, title: "Agenda", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111312" },
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // per-request CSP nonce from src/proxy.ts (Next adds it to its own scripts; this inline one needs it explicitly)
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="es-AR" className={`${instrumentSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* saved theme before first paint (no flash) */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant inline script, no user input; allowed by the CSP nonce */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
