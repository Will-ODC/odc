import { useRef } from "react";
import type { TouchEvent } from "react";

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
  onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove?: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd?: (event: TouchEvent<HTMLElement>) => void;
  onTouchCancel?: () => void;
}

/** Zoomed in, a sideways drag pans the page; it is never a swipe. */
function zoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) > 1;
}

/**
 * Calls `onSwipeLeft` when one finger swipes left over the element the
 * handlers are spread on (#554). A mouse never swipes: it has buttons for
 * that. Left out, the handlers are empty and nothing listens.
 *
 * Touch events, not pointer events: React listens to them passively and the
 * browser never cancels them for a scroll, so the page keeps its own
 * panning and zoom (no `touch-action` needed) and this only watches.
 */
export function useSwipeLeft(onSwipeLeft?: () => void): SwipeHandlers {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  if (!onSwipeLeft) return {};
  return {
    onTouchStart: (event) => {
      const touch = event.touches[0];
      start.current =
        event.touches.length !== 1 || !touch || zoomed()
          ? null
          : { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    },
    // A second finger makes it a pinch, not a swipe, for the rest of it.
    onTouchMove: (event) => {
      if (event.touches.length > 1) start.current = null;
    },
    onTouchEnd: (event) => {
      const from = start.current;
      start.current = null;
      if (!from || event.touches.length > 0 || zoomed()) return;
      const touch = Array.from(event.changedTouches).find(
        (one) => one.identifier === from.id,
      );
      if (touch && isLeftSwipe(touch.clientX - from.x, touch.clientY - from.y))
        onSwipeLeft();
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
