import { useRef } from "react";
import type { PointerEvent } from "react";

/** How far a finger must travel left, in CSS pixels, to count as a swipe. */
export const SWIPE_MIN = 60;
/** How much more sideways than up or down it must travel. */
export const SWIPE_RATIO = 1.5;

/**
 * A left swipe: far enough, and clearly more sideways than vertical, so a
 * scroll, a tap or a diagonal drag is never one.
 */
export function isLeftSwipe(dx: number, dy: number): boolean {
  return dx <= -SWIPE_MIN && Math.abs(dx) > SWIPE_RATIO * Math.abs(dy);
}

export interface SwipeHandlers {
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
}

/**
 * Calls `onSwipeLeft` when a touch or pen swipes left over the element the
 * handlers are spread on (#554). A mouse never swipes: it has buttons for
 * that. Left out, the handlers are empty and nothing listens.
 *
 * The element should allow only vertical panning (`touch-action: pan-y`), so
 * the browser keeps scrolling and leaves sideways travel to this hook.
 */
export function useSwipeLeft(onSwipeLeft?: () => void): SwipeHandlers {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  if (!onSwipeLeft) return {};
  return {
    onPointerDown: (event) => {
      start.current =
        event.pointerType === "mouse" || !event.isPrimary
          ? null
          : { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event) => {
      const from = start.current;
      start.current = null;
      if (!from || from.id !== event.pointerId) return;
      if (isLeftSwipe(event.clientX - from.x, event.clientY - from.y))
        onSwipeLeft();
    },
    // The browser took the gesture (a scroll, a zoom): it is not a swipe.
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
