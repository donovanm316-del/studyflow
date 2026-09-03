import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "./manifest";

/**
 * Phase 6A, Part 3/14 — the web app manifest is what makes "Add to Home Screen" produce something
 * that feels like an app: a real name, icons at the sizes Android/Chrome actually request, and
 * `standalone` display so the browser chrome disappears. This exercises the manifest the way the
 * browser actually consumes it — as data — rather than guarding source text.
 */
describe("web app manifest (installability)", () => {
  const result = manifest();

  it("has a real app name, not a generic placeholder", () => {
    expect(result.name).toBe("StudyFlow");
    expect(result.short_name).toBe("StudyFlow");
  });

  it("uses standalone display so the browser chrome is hidden once installed", () => {
    expect(result.display).toBe("standalone");
  });

  it("declares both a 192x192 and a 512x512 icon", () => {
    const sizes = (result.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("declares a maskable icon for adaptive-icon platforms", () => {
    expect((result.icons ?? []).some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("every declared icon file actually exists in /public", () => {
    for (const icon of result.icons ?? []) {
      const filePath = join(process.cwd(), "public", icon.src.replace(/^\//, ""));
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it("sets a start_url inside the app, not the marketing landing page", () => {
    expect(result.start_url).toBe("/dashboard");
  });

  it("sets a theme_color and background_color for the install/splash experience", () => {
    expect(result.theme_color).toBeTruthy();
    expect(result.background_color).toBeTruthy();
  });
});
