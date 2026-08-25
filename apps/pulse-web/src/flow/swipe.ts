import type { Ballot, Poll } from "../api/types.js";

/**
 * The swipe ballot's decisions, kept out of the component for the same reason
 * `story.ts` keeps the step order out: they are rules, they are worth testing
 * exhaustively, and a screen should render a decision rather than make one.
 *
 * A swipe ballot answers a poll with exactly two choices. Left is the first
 * choice, right is the second — the order the poll gives them, never a guess
 * from their wording.
 */

export type Side = "left" | "right";

/** How far a drag must travel, in pixels, before releasing counts as a vote. */
export const COMMIT_DISTANCE = 70;

/** A swipe ballot can only answer a poll shaped like one. */
export function isSwipeable(poll: Poll): boolean {
  return poll.method === "single" && poll.choices.length === 2;
}

/** The choice index a side stands for. */
export function choiceFor(side: Side): number {
  return side === "left" ? 0 : 1;
}

/** The ballot a side casts. */
export function ballotFor(side: Side): Ballot {
  return [choiceFor(side)];
}

export interface Lean {
  /** Which way the drag is going, or null while it is still at rest. */
  side: Side | null;
  /** 0 at rest, 1 once the drag has travelled far enough to commit. */
  strength: number;
}

/**
 * How far the screen should show a drag leaning. Clamped at 1 so the tint stops
 * deepening once the drag is past the point where releasing would commit —
 * past that, more travel says nothing new.
 */
export function leanOf(dx: number, distance = COMMIT_DISTANCE): Lean {
  if (dx === 0 || Number.isNaN(dx)) return { side: null, strength: 0 };
  return {
    side: dx < 0 ? "left" : "right",
    strength: Math.min(1, Math.abs(dx) / distance),
  };
}

/**
 * The side a released drag votes for, or null if it did not travel far enough
 * and should spring back. A tap is not a drag and is decided by `sideOfPoint`.
 */
export function releaseOf(dx: number, distance = COMMIT_DISTANCE): Side | null {
  if (dx <= -distance) return "left";
  if (dx >= distance) return "right";
  return null;
}

/**
 * The side a tap landed on. `width` is the full width of the two halves, so the
 * midpoint is the seam between them.
 */
export function sideOfPoint(offsetX: number, width: number): Side {
  return offsetX > width / 2 ? "right" : "left";
}

/** The arrow key for a side, and the side for an arrow key. */
export function sideOfKey(key: string): Side | undefined {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return undefined;
}
