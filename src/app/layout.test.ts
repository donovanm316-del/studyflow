import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the root layout's PWA/iOS metadata (Phase 6A, Part 3/14). Not executed
 * directly — `layout.tsx` calls `next/font/google`, which only works inside Next's own build
 * pipeline, so this checks the same way `Modal.test.ts`/`WorkItemModal.test.ts` do for
 * behavior that can't run under Vitest directly.
 *
 * iOS/iPadOS ignores the web app manifest for "Add to Home Screen" and reads these Apple-specific
 * meta tags directly instead, which is why they're declared here rather than relying on
 * `manifest.ts` alone.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("root layout PWA metadata", () => {
  it("marks the app as capable of running standalone on iOS/iPadOS", () => {
    expect(SOURCE).toMatch(/appleWebApp:\s*{[^}]*capable:\s*true/);
    // Belt-and-suspenders: Next's `appleWebApp.capable` alone was verified NOT to emit the actual
    // `apple-mobile-web-app-capable` meta tag in this Next.js version — declared explicitly instead.
    expect(SOURCE).toContain('"apple-mobile-web-app-capable": "yes"');
  });

  it("links the web app manifest", () => {
    expect(SOURCE).toContain('manifest: "/manifest.webmanifest"');
  });

  it("declares an apple touch icon", () => {
    expect(SOURCE).toMatch(/apple:\s*"\/icons\/apple-touch-icon\.png"/);
  });

  it("sets a theme color matching the manifest's", () => {
    expect(SOURCE).toContain('themeColor: "#1a3552"');
  });

  it("lets content reach into safe areas (notch/home indicator) once installed standalone", () => {
    expect(SOURCE).toContain('viewportFit: "cover"');
  });
});
