// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UNREACHABLE } from "../src/api/http.js";
import { ApiError } from "../src/api/types.js";
import { useCastVote } from "../src/hooks/use-cast-vote.js";
import { results, stubApi } from "./stub-api.js";

afterEach(cleanup);

it("sends every approval choice and retains the complete ballot", async () => {
  const cast = vi.fn(async (_id: string, ballot: number[]) => ({
    status: "changed" as const,
    ballot: [...ballot].sort(),
    results: results({ method: "approval" }),
  }));
  const { result } = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
  act(() => void result.current.cast([2, 0]));
  expect(cast).toHaveBeenCalledExactlyOnceWith("p1", [2, 0]);
  await waitFor(() => expect(result.current.state.status).toBe("counted"));
  expect(result.current.state).toMatchObject({ ballot: [0, 2], changed: true });
});

it("marks a failure refused only when the server answered", async () => {
  const cast = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(409, "Not now"))
    .mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
  act(() => void result.current.cast([0]));
  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: "failed",
      message: "Not now",
      refused: true,
    }),
  );
  act(() => void result.current.cast([0]));
  await waitFor(() =>
    expect(result.current.state).toMatchObject({
      status: "failed",
      refused: false,
    }),
  );
});

it.each([
  // Decided before anything is written: the earlier answer stands.
  [400, true],
  [403, true],
  [404, true],
  [413, true],
  [429, true],
  // No complete answer, a fault possibly after the write, or a yes the app
  // could not read: the vote may be stored, so the screen asks (#527).
  [0, false],
  [500, false],
  [502, false],
  [504, false],
  [200, false],
])(
  "reads a failed send with status %i as refused: %s",
  async (status, refused) => {
    const cast = vi.fn().mockRejectedValueOnce(new ApiError(status, "Said"));
    const { result } = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
    act(() => void result.current.cast([0]));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "failed",
        message: "Said",
        refused,
      }),
    );
  },
);

it("says a failure with no answer in the app-wide sentence (#527)", async () => {
  const cast = vi.fn().mockRejectedValueOnce(new TypeError("network"));
  const { result } = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
  act(() => void result.current.cast([0]));
  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: "failed",
      message: UNREACHABLE,
      refused: false,
    }),
  );
  expect(UNREACHABLE).toBe(
    "Couldn't reach pulse. Check your connection and try again.",
  );
});

it("copies picks while sending and ignores an empty ballot", async () => {
  let release: (() => void) | undefined;
  const cast = vi.fn(
    (_id: string, ballot: number[]) =>
      new Promise<{
        status: "counted";
        ballot: number[];
        results: ReturnType<typeof results>;
      }>((resolve) => {
        release = () =>
          resolve({ status: "counted", ballot, results: results() });
      }),
  );
  const { result } = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
  act(() => void result.current.cast([]));
  expect(cast).not.toHaveBeenCalled();
  const ballot = [0, 2];
  act(() => void result.current.cast(ballot));
  ballot.push(1);
  expect(result.current.state).toMatchObject({
    status: "casting",
    ballot: [0, 2],
  });
  expect(cast).toHaveBeenCalledExactlyOnceWith("p1", [0, 2]);
  await act(async () => release?.());
  expect(result.current.state).toMatchObject({
    status: "counted",
    ballot: [0, 2],
    changed: false,
  });
  act(() => result.current.reset());
  expect(result.current.state).toEqual({ status: "idle" });
});

it("settles each send with its end state, even once the hook is gone (#488)", async () => {
  let release!: () => void;
  const cast = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ status: "changed", ballot: [1], results: results() });
        }),
    )
    .mockRejectedValueOnce(new Error("offline"));
  const { result, unmount } = renderHook(() =>
    useCastVote(stubApi({ cast }), "p1"),
  );
  let sent!: Promise<unknown>;
  act(() => {
    sent = result.current.cast([1]);
  });
  unmount();
  release();
  await expect(sent).resolves.toMatchObject({
    status: "counted",
    ballot: [1],
    changed: true,
  });
  const second = renderHook(() => useCastVote(stubApi({ cast }), "p1"));
  let failed!: Promise<unknown>;
  act(() => {
    failed = second.result.current.cast([0]);
  });
  await expect(failed).resolves.toMatchObject({
    status: "failed",
    refused: false,
  });
  await expect(second.result.current.cast([])).resolves.toEqual({
    status: "idle",
  });
});
