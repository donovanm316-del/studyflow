import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard on the dialog's sizing classes rather than a rendered-DOM test — this project has no
 * DOM testing library, and the bug being guarded against was purely a CSS one.
 *
 * The bug: the dialog had no height cap and no internal scrolling, so a form taller than the
 * viewport was clipped at *both* ends by the centering wrapper. On a phone that put the work item
 * form's own Save/Cancel buttons off-screen with no way to scroll to them — assignments simply
 * could not be added. Verified fixed in a 390x664 viewport, where the Add button starts below the
 * fold and becomes reachable by scrolling the modal body.
 */
const MODAL_SOURCE = readFileSync(join(process.cwd(), "src/components/ui/Modal.tsx"), "utf8");

describe("Modal sizing (mobile reachability)", () => {
  it("caps the dialog to the viewport height", () => {
    expect(MODAL_SOURCE).toContain("max-h-[calc(100dvh-2rem)]");
  });

  it("uses dvh, so collapsing mobile browser chrome cannot re-clip it", () => {
    expect(MODAL_SOURCE).toMatch(/max-h-\[calc\(100dvh/);
    expect(MODAL_SOURCE).not.toMatch(/max-h-\[calc\(100vh/);
  });

  it("scrolls its body so content below the fold stays reachable", () => {
    expect(MODAL_SOURCE).toContain("overflow-y-auto");
  });

  it("lays the dialog out as a column so the header stays put while the body scrolls", () => {
    expect(MODAL_SOURCE).toMatch(/flex\s+max-h-\[calc\(100dvh-2rem\)\]\s+w-full\s+max-w-md\s+flex-col/);
  });
});
