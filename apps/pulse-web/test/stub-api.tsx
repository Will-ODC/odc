import type {
  Poll,
  PulseApi,
  Results,
  SuggestResult,
  Suggestion,
} from "../src/api/types.js";

/**
 * jsdom has no `PointerEvent`, and without one testing-library falls back to a
 * plain `Event` that carries no coordinates - every drag would arrive as a drag
 * of zero pixels and the gesture tests would pass without testing the gesture.
 * `MouseEvent` already carries clientX, so it is the whole of what is needed.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

export function installPointerEvents(): void {
  globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

export function poll(over: Partial<Poll> = {}): Poll {
  return {
    id: "ads-free",
    question: "Should the ODC stay free of paid ads?",
    choices: ["No", "Yes"],
    method: "single",
    next: [null, null],
    acceptsSuggestions: false,
    closesAt: null,
    open: true,
    ...over,
  };
}

/**
 * A real `Results`, not `{} as Results`.
 *
 * It used to be the empty cast, which typechecked and was a lie: nothing read
 * it, so nothing noticed. The moment a screen actually rendered the counts it
 * would have thrown on `results.choices`. A stub that cannot be rendered is a
 * test that is not testing the thing.
 */
export function results(over: Partial<Results> = {}): Results {
  const base = poll();
  return {
    pollId: base.id,
    question: base.question,
    method: base.method,
    voters: 0,
    choices: base.choices.map((label, index) => ({
      index,
      label,
      count: 0,
      share: 0,
    })),
    ...over,
  };
}

/** Nobody has voted yet, in the shape the server would really send. */
export const EMPTY_RESULTS: Results = results();

/**
 * What the server really returns to the person who just voted: at least one
 * voter, because their own vote is in it. `EMPTY_RESULTS` is a shape no cast
 * can answer with - handing it back from `cast` made every voting test render
 * "0 people so far", which is a state the panel's own comment calls impossible.
 */
export const CAST_RESULTS: Results = results({
  voters: 1,
  choices: results().choices.map((choice) =>
    choice.index === 1 ? { ...choice, count: 1, share: 100 } : choice,
  ),
});

/** A cast the server would really answer with: this choice, these counts. */
export function counted(choice: number, of: Results) {
  return { status: "counted" as const, ballot: [choice], results: of };
}

/**
 * A plain object is enough: `PulseApi` is structural, so a stub does not have
 * to extend anything. Anything a test has not said the screen may call rejects
 * loudly rather than quietly answering.
 */
export function stubApi(over: Partial<PulseApi> = {}): PulseApi {
  const unused = (name: string) => () =>
    Promise.reject(new Error(`the ballot should not call ${name}`));
  return {
    poll: () => Promise.resolve(poll()),
    cast: () =>
      Promise.resolve({
        status: "counted" as const,
        ballot: [1],
        results: CAST_RESULTS,
      }),
    suggestions: () => Promise.resolve([] as Suggestion[]),
    suggest: () =>
      Promise.resolve({
        status: "added",
        suggestion: { id: "s1", text: "something", count: 1 },
        related: [],
      } satisfies SuggestResult),
    requestLink: unused("requestLink"),
    redeem: unused("redeem"),
    me: unused("me"),
    signOut: unused("signOut"),
    myBallot: unused("myBallot"),
    results: unused("results"),
    ...over,
  } as PulseApi;
}

/** Answers each poll id from a map, and 404s anything else. */
export function graph(polls: Poll[]): (id: string) => Promise<Poll> {
  const byId = new Map(polls.map((one) => [one.id, one]));
  return async (id: string) => {
    const found = byId.get(id);
    if (!found) throw new Error(`no such poll: ${id}`);
    return found;
  };
}
