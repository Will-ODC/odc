/**
 * A decision, with nothing about how it is drawn.
 *
 * The chat preview (#228) shows one of these as a popup in a conversation, but
 * the same question could be a ballot screen, a card in a feed or an email.
 * Everything here is what the question IS and what may be done with it; where
 * it sits and what it looks like belong to whoever renders it.
 *
 * Pure on purpose, like `route.ts` and `swipe.ts`: which answers may be given,
 * and when, are decisions worth testing exhaustively without React.
 *
 * Choices carry stable ids rather than being addressed by position. Pulse has
 * already been bitten by indexing one list with a position from another
 * (ADR-0021); an id cannot point at the wrong row when a list is reordered.
 */

/**
 * Who can see an answer once it is given.
 *
 * `private` is the default and the only value the preview uses. `visible`
 * exists so the default is a choice rather than the only thing the type can
 * say - a group that wants answers shown has somewhere to put that.
 */
export type Privacy = "private" | "visible";

export interface DecisionChoice {
  /** Stable across reorderings and relabellings. What an answer records. */
  id: string;
  label: string;
}

export interface Decision {
  id: string;
  question: string;
  choices: readonly DecisionChoice[];
  /** Still taking answers. A closed decision shows its choices but takes none. */
  open: boolean;
  privacy: Privacy;
}

/** Where the person stands. Only a confirmed participant may answer. */
export type Eligibility = "confirmed" | "unconfirmed";

/**
 * What the person may do with the decision right now.
 *
 * `closed` outranks `unconfirmed`: a question that takes no answers from
 * anyone should say so, rather than send someone off to confirm their account
 * for a question that will still be shut when they come back.
 */
export type Access = "answerable" | "unconfirmed" | "closed";

/**
 * A decision, with the defaults filled in.
 *
 * Open and private unless said otherwise. Refuses a question nobody could
 * meaningfully answer - fewer than two choices - and two choices sharing an
 * id, which would make an answer ambiguous.
 */
export function defineDecision(input: {
  id: string;
  question: string;
  choices: readonly DecisionChoice[];
  open?: boolean;
  privacy?: Privacy;
}): Decision {
  if (input.choices.length < 2) {
    throw new Error(`decision ${input.id} needs at least two choices`);
  }
  const ids = new Set(input.choices.map((choice) => choice.id));
  if (ids.size !== input.choices.length) {
    throw new Error(`decision ${input.id} has two choices with one id`);
  }
  return {
    id: input.id,
    question: input.question,
    choices: input.choices,
    open: input.open ?? true,
    privacy: input.privacy ?? "private",
  };
}

export function accessTo(decision: Decision, eligibility: Eligibility): Access {
  if (!decision.open) return "closed";
  if (eligibility === "unconfirmed") return "unconfirmed";
  return "answerable";
}

/** The label for an answer, or `null` when the id is not one of the choices. */
export function choiceLabel(
  decision: Decision,
  choiceId: string | null,
): string | null {
  if (choiceId === null) return null;
  return (
    decision.choices.find((choice) => choice.id === choiceId)?.label ?? null
  );
}

/**
 * Whether pressing Submit may send an answer.
 *
 * Only when the person may answer, has picked one of THIS decision's choices,
 * and nothing is already on its way - the last is what stops a double press
 * sending twice.
 */
export function canSubmit(state: {
  decision: Decision;
  access: Access;
  picked: string | null;
  sending: boolean;
}): boolean {
  return (
    state.access === "answerable" &&
    !state.sending &&
    choiceLabel(state.decision, state.picked) !== null
  );
}

/** The sentence that tells someone who will see their answer. */
export function privacyNote(privacy: Privacy): string {
  return privacy === "private"
    ? "Your answer is private."
    : "Your answer will be visible to the group.";
}

/**
 * What the button that opens the decision says.
 *
 * It opens in every state - a closed or not-yet-answerable question can still
 * be read - so only the words change, never whether it can be pressed.
 */
export function openerLabel(access: Access, answered: boolean): string {
  if (access !== "answerable") return "See the question";
  return answered ? "Change your answer" : "Answer";
}
