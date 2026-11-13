// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import type { ContributionsApi } from "../src/api/contributions.js";
import { SIGNED_OUT_KEY, useSession } from "../src/hooks/use-session.js";
import { stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const savedVote = {
  pollId: "saved",
  question: "A saved question?",
  choices: ["Yes"],
  open: true,
  castAt: "2026-11-10T12:00:00.000Z",
  ballot: [0],
  closesAt: null,
};
const contribution = {
  id: "park",
  title: "Make the park accessible",
  description: "Build a ramp together.",
  communityBenefit: null,
  needs: null,
  kind: "project" as const,
  organizerName: "Test organizer",
  community: { id: "pulse-general", label: "General" },
  pollId: null,
  commercial: null,
  fund: null,
  status: "open" as const,
  createdAt: "2026-11-11T12:00:00.000Z",
  participations: [],
  updates: [],
};
const client = {
  list: async () => ({ contributions: [contribution], nextCursor: null }),
  sendMessage: async () => {},
  messages: async () => [],
  detail: async () => ({ contribution, canManage: false }),
  create: async () => contribution,
  participate: async () => contribution,
  update: async () => contribution,
} as unknown as ContributionsApi;
const person = (id: string) => ({
  id,
  email: `${id}@example.test`,
  community: null,
});
const rail = () => within(screen.getByRole("navigation", { name: "My votes" }));

it.each([
  ["signs out in another tab", "announced"],
  ["session expires", "expired"],
] as const)(
  "stops showing the previous person's answers when their %s",
  async (_label, how) => {
    let who: string | null = "voter";
    render(
      <ContributionDetail
        api={stubApi({
          me: async () => (who ? person(who) : null),
          myVotes: async () =>
            who
              ? { votes: [savedVote], nextCursor: null }
              : { votes: [], nextCursor: null },
        })}
        id="park"
        client={client}
      />,
    );
    expect(await rail().findByText("Your answer: Yes")).toBeTruthy();
    who = null;
    if (how === "announced")
      window.dispatchEvent(
        new StorageEvent("storage", { key: SIGNED_OUT_KEY }),
      );
    else window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(rail().queryByText("Your answer: Yes")).toBeNull(),
    );
  },
);

/** A `me()` whose answers the test hands out one by one, in any order. */
function deferredMe() {
  const pending: Array<(value: ReturnType<typeof person> | null) => void> = [];
  const me = vi.fn(
    () =>
      new Promise<ReturnType<typeof person> | null>((resolve) => {
        pending.push(resolve);
      }),
  );
  return { me, pending };
}

it("ignores an older identity answer that arrives after a newer account's", async () => {
  const { me, pending } = deferredMe();
  const api = stubApi({ me });
  const { result } = renderHook(() =>
    useSession(api, { recheckSignedIn: true }),
  );
  await act(async () => pending[0]!(person("a")));
  expect(result.current.session).toMatchObject({ me: { id: "a" } });
  const before = pending.length;
  await act(async () => window.dispatchEvent(new Event("focus")));
  const older = pending[pending.length - 1]!;
  await act(async () => window.dispatchEvent(new Event("focus")));
  const newer = pending[pending.length - 1]!;
  expect(pending.length).toBeGreaterThan(before + 1);
  // The newer check answers first: account B.
  await act(async () => newer(person("b")));
  expect(result.current.session).toMatchObject({ me: { id: "b" } });
  // The older one, still saying A, arrives late and changes nothing.
  await act(async () => older(person("a")));
  expect(result.current.session).toMatchObject({ me: { id: "b" } });
});

it("ignores an identity answer already on its way when another tab signs out", async () => {
  const { me, pending } = deferredMe();
  const api = stubApi({ me });
  const { result } = renderHook(() =>
    useSession(api, { recheckSignedIn: true }),
  );
  await act(async () => pending[0]!(person("a")));
  await act(async () => window.dispatchEvent(new Event("focus")));
  const onItsWay = pending[pending.length - 1]!;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_OUT_KEY })),
  );
  expect(result.current.session).toEqual({
    status: "signedOut",
    ended: "elsewhere",
  });
  await act(async () => onItsWay(person("a")));
  expect(result.current.session).toEqual({
    status: "signedOut",
    ended: "elsewhere",
  });
});

it.each([
  ["a newer check says nobody is signed in", "nobody"],
  ["a newer check fails", "fails"],
  ["another tab announces a sign-out", "announced"],
] as const)(
  "settles a page still loading its first answer when %s",
  async (_label, how) => {
    const pending: Array<{
      resolve: (value: ReturnType<typeof person> | null) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const me = vi.fn(
      () =>
        new Promise<ReturnType<typeof person> | null>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    const api = stubApi({ me });
    const { result } = renderHook(() =>
      useSession(api, { recheckSignedIn: true }),
    );
    expect(result.current.session).toEqual({ status: "loading" });
    const first = pending[0]!;
    if (how === "announced")
      await act(async () =>
        window.dispatchEvent(
          new StorageEvent("storage", { key: SIGNED_OUT_KEY }),
        ),
      );
    else {
      await act(async () => window.dispatchEvent(new Event("focus")));
      const newer = pending[pending.length - 1]!;
      await act(async () =>
        how === "nobody" ? newer.resolve(null) : newer.reject(new Error("x")),
      );
    }
    expect(result.current.session).toEqual(
      how === "fails" ? { status: "unknown" } : { status: "signedOut" },
    );
    // The first answer, arriving late, no longer counts.
    await act(async () => first.resolve(person("a")));
    expect(result.current.session.status).not.toBe("signedIn");
  },
);
