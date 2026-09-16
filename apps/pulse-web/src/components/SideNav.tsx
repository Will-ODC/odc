import "./Rail.css";
import "./SideNav.css";

/** One question the run has been through. */
export interface RunStep {
  id: string;
  /**
   * Its wording, once the poll behind it has loaded. A step is listed before
   * that happens — the run knows it walked through here, and waiting for the
   * text would make the rail flicker in and out as someone moves.
   */
  question?: string | undefined;
}

/**
 * The left rail: the questions answered so far.
 *
 * It is the Back control made visible. Back already existed and already only
 * ever stepped off the end of the trail; on a wide screen there is room to
 * show the whole trail instead, so going back two questions is one press
 * rather than two, and you can see where you are before you press anything.
 *
 * It lists only where the run has BEEN. What is ahead depends on answers that
 * have not been given yet, so a forward list would be a guess — and what one
 * answer opens is already named on the ballot and in the right rail.
 */
export function SideNav({
  steps,
  current,
  onGoTo,
}: {
  steps: readonly RunStep[];
  /** Index into `steps` of the question being asked now. */
  current: number;
  /** Go back to the step at this index. Never called for `current`. */
  onGoTo: (index: number) => void;
}) {
  return (
    <nav className="rail-nav" aria-label="Answered">
      <div>
        {/*
         * "Answered", not "This run". A run is what this codebase calls the
         * walk through the graph, and it is the right word in `Run.tsx` — but
         * it is a word from the implementation, and the person reading this
         * rail is being shown the questions they have answered.
         */}
        <h2 className="rail__heading">Answered</h2>
        <ol className="rail-nav__steps">
          {steps.map((step, index) => {
            const name = step.question ?? `Question ${index + 1}`;
            const here = index === current;
            return (
              <li key={step.id}>
                {here ? (
                  /*
                   * The question being asked is not a link to itself. A
                   * control that goes nowhere still takes a tab stop and still
                   * answers a press, which is how a nav teaches people that
                   * pressing it does nothing.
                   */
                  <span
                    className="rail-nav__step rail-nav__step--here"
                    aria-current="step"
                  >
                    {name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rail-nav__step"
                    onClick={() => onGoTo(index)}
                  >
                    {name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
