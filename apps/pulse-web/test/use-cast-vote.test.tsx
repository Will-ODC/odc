// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
  act(() => result.current.cast([2, 0]));
  expect(cast).toHaveBeenCalledExactlyOnceWith("p1", [2, 0]);
  await waitFor(() => expect(result.current.state.status).toBe("counted"));
  expect(result.current.state).toMatchObject({ ballot: [0, 2], changed: true });
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
  act(() => result.current.cast([]));
  expect(cast).not.toHaveBeenCalled();
  const ballot = [0, 2];
  act(() => result.current.cast(ballot));
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
