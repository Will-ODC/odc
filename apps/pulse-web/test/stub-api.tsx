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

export const EMPTY_RESULTS = {} as Results;

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
        results: EMPTY_RESULTS,
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
