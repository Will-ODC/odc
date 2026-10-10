import type { Decision, Eligibility } from "./decision.js";
import { defineDecision } from "./decision.js";

/**
 * The sample data behind the chat preview (#228), and the states it can be
 * put in. Sample only: nothing here is sent anywhere, and live voting in a
 * conversation comes later.
 *
 * Kept apart from `decision.ts` so the decision type stays about decisions -
 * this file is the one place the preview's conversation, scenarios and
 * pretend sending live.
 */

export const SAMPLE_DECISION: Decision = defineDecision({
  id: "late-night",
  question: "Which evening should the library stay open late?",
  choices: [
    { id: "tue", label: "Tuesday" },
    { id: "wed", label: "Wednesday" },
    { id: "thu", label: "Thursday" },
  ],
});

export type ChatMessage =
  | { kind: "text"; id: string; author: string; text: string }
  /** A decision posted into the conversation, opened from its card. */
  | { kind: "decision"; id: string; author: string; decisionId: string };

export const SAMPLE_CONVERSATION: readonly ChatMessage[] = [
  {
    kind: "text",
    id: "m1",
    author: "Amira",
    text: "The library can fund one late evening a week from next month.",
  },
  {
    kind: "text",
    id: "m2",
    author: "Jon",
    text: "Thursdays would suit the study group, but I know not everyone agrees.",
  },
  {
    kind: "text",
    id: "m3",
    author: "Amira",
    text: "Let's settle it properly. Answer below.",
  },
  {
    kind: "decision",
    id: "m4",
    author: "Amira",
    decisionId: SAMPLE_DECISION.id,
  },
];

/** The states the preview can be shown in, picked from a control on the page. */
export type PreviewState = "eligible" | "unconfirmed" | "closed" | "sendFails";

export const PREVIEW_STATES: readonly { value: PreviewState; label: string }[] =
  [
    { value: "eligible", label: "Eligible" },
    { value: "unconfirmed", label: "Not yet confirmed" },
    { value: "closed", label: "Poll closed" },
    { value: "sendFails", label: "Send fails" },
  ];

export function isPreviewState(value: string): value is PreviewState {
  return PREVIEW_STATES.some((state) => state.value === value);
}

export interface Scenario {
  decision: Decision;
  eligibility: Eligibility;
  /** The first send fails, so the way back from a failure can be tried. */
  failFirst: boolean;
}

export function scenarioFor(state: PreviewState): Scenario {
  switch (state) {
    case "eligible":
      return {
        decision: SAMPLE_DECISION,
        eligibility: "confirmed",
        failFirst: false,
      };
    case "unconfirmed":
      return {
        decision: SAMPLE_DECISION,
        eligibility: "unconfirmed",
        failFirst: false,
      };
    case "closed":
      return {
        decision: { ...SAMPLE_DECISION, open: false },
        eligibility: "confirmed",
        failFirst: false,
      };
    case "sendFails":
      return {
        decision: SAMPLE_DECISION,
        eligibility: "confirmed",
        failFirst: true,
      };
  }
}

/** What the preview says when a pretend send fails. One plain sentence. */
export const SEND_FAILED =
  "Your answer did not go through. Check your connection and try again.";

/**
 * A pretend send: waits, then succeeds - or, when `failFirst`, fails the
 * first attempt and succeeds every one after it.
 *
 * `wait` is the only delay, handed in so a test can hold a send open or let
 * it through at once. No request is made.
 */
export function previewSender(
  failFirst: boolean,
  wait: () => Promise<void>,
): (choiceId: string) => Promise<void> {
  let attempts = 0;
  return async () => {
    attempts += 1;
    const attempt = attempts;
    await wait();
    if (failFirst && attempt === 1) throw new Error(SEND_FAILED);
  };
}
