import type { MetadataRoute } from "next";

/**
 * Web app manifest (Phase 6A, Part 3) — what makes "Add to Home Screen" produce something that
 * feels like an app rather than a browser shortcut: a real name, branded icons at the sizes
 * Android/Chrome actually ask for, and `standalone` display so the browser chrome disappears.
 *
 * This is deliberately the extent of it — no service worker, no offline caching, no push. Those
 * are real infrastructure decisions for a later phase, not something to back into via a manifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StudyFlow",
    short_name: "StudyFlow",
    description: "A practical time-management planner for students, built around a real schedule you can follow.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#1a3552",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
