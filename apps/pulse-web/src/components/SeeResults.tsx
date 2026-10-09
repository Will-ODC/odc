import type { RefObject } from "react";

/**
 * The quiet way to the numbers - after a vote (`<Outcome>`) and under a
 * question that has closed (both ballots). One control in three places, so it
 * looks and reads the same in each.
 *
 * Quieter than NEXT on purpose. The run is for answering; the numbers are
 * there for whoever wants them, and are never the thing being offered first.
 */
export function SeeResults({
  onOpen,
  buttonRef,
}: {
  onOpen: () => void;
  /**
   * The control focus returns to when the panel closes. Closing unmounts the
   * panel, so without somewhere to send it focus drops to the document body.
   */
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  return (
    <button
      type="button"
      className="outcome__results"
      onClick={onOpen}
      ref={buttonRef}
    >
      See results
    </button>
  );
}
