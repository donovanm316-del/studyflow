import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppDataProvider } from "@/lib/data/store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StudyFlow",
  description: "A practical time-management app for students.",
  // `manifest.ts` supplies the web app manifest itself; this just links it. iOS/iPadOS ignores the
  // manifest for home-screen install and instead reads these Apple-specific tags directly (Phase
  // 6A, Part 3) — both are declared so "Add to Home Screen" looks right on either platform.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StudyFlow",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  // `appleWebApp.capable` alone does not emit `apple-mobile-web-app-capable` in this Next.js
  // version (verified: the rendered `<head>` was missing it) — that tag is still what makes
  // Safari drop its browser chrome on "Add to Home Screen" for iOS versions that don't yet honor
  // the manifest's `display: standalone`, so it's declared explicitly rather than assumed.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a3552",
  // Lets content reach into the notch/home-indicator safe areas deliberately (via `env(safe-area-inset-*)`
  // in globals.css) instead of being pushed away from them by default — matters once launched
  // standalone from a home screen, where there's no browser chrome to keep clear of.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AppDataProvider>{children}</AppDataProvider>
      </body>
    </html>
  );
}
