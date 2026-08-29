/**
 * The exact block-list transformations behind the student's manual scheduling decisions, factored
 * out of the store so a "what happens if I do this?" preview can run the *same* transformation the
 * real action would (Phase 4.5B, Part 5/6).
 *
 * Without this, a preview would have to re-describe what moving a session does, and the two
 * descriptions could silently drift apart — the preview would start lying. Here there is one
 * definition: `AppDataProvider` applies it for real, `previewMove` applies it to a throwaway copy.
 */
import type { ScheduleBlock } from "@/types/models";

/**
 * Moving a session pins it to its new time as a manual override. The original generated block
 * isn't marked skipped — it simply isn't regenerated, because the engine counts manual-override
 * minutes against the item's remaining work (see `manualMinutesByItem` in scheduler.ts).
 */
export function fixedBlocksAfterMove(
  fixedBlocks: ScheduleBlock[],
  block: ScheduleBlock,
  newStart: string,
  newEnd: string,
  newId: string
): ScheduleBlock[] {
  return [
    ...fixedBlocks,
    { ...block, id: newId, start: newStart, end: newEnd, origin: "manual-override", status: "planned" },
  ];
}

/**
 * "I can't do this today" → the session is recorded as skipped, and any *other* manually-pinned
 * blocks still planned for that day are released so the rest of the day can genuinely reflow
 * around the change rather than staying locked to slots chosen before it.
 */
export function fixedBlocksAfterReplanToday(
  fixedBlocks: ScheduleBlock[],
  block: ScheduleBlock,
  newId: string
): ScheduleBlock[] {
  const dateOnly = block.start.slice(0, 10);
  const released = fixedBlocks.filter(
    (b) =>
      !(b.origin === "manual-override" && b.status === "planned" && b.start.slice(0, 10) === dateOnly && b.id !== block.id)
  );
  return [...released, { ...block, id: newId, status: "skipped" }];
}
