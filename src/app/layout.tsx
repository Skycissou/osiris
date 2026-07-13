import type { Metadata, Viewport } from "next";
import ErrorBoundary from '@/components/ErrorBoundary';
import TelemetryInit from '@/components/TelemetryInit';
import GlobalDebugCapsule from '@/components/GlobalDebugCapsule';
import "./globals.css";

const SITE_NAME = "OSIRIS";
const SITE_TITLE = "OSIRIS — Cockpit cartographique OSINT";
const SITE_DESCRIPTION = "Cockpit cartographique OSINT défensif : visualisation de sources ouvertes françaises sur fond de carte interactif.";

export const viewport: Viewport = {
  themeColor: "#54bdde",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: "%s | OSIRIS",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" dir="ltr">
      <body className="antialiased">
        <TelemetryInit />
        <ErrorBoundary name="OSIRIS Core">
          {children}
        </ErrorBoundary>
        {/* 🩺 Capsule debug LIVE sur TOUT le site (accueil compris) — 1 instance globale,
            gatée NEXT_PUBLIC_DEBUG_CAPSULE (coupe le montage à =0). Cf. GlobalDebugCapsule. */}
        <GlobalDebugCapsule />
      </body>
    </html>
  );
}
