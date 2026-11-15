// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import { useClosedResults } from "../src/hooks/use-closed-results.js";
import { results } from "./stub-api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows closed results without your answer when the ballot read stalls (#629)", async () => {
  // Each request's deadline, so the test can let one pass without waiting.
  const deadlines = new Map<string, AbortController>();
  let next: AbortController | undefined;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    next = new AbortController();
    return next.signal;
  });
  const tally = results({ voters: 3 });
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (next) deadlines.set(url, next);
    next = undefined;
    if (url.endsWith("/results"))
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(tally),
      } as Response);
    // The ballot read never answers; like a real fetch, only its signal ends it.
    return new Promise((_, reject) =>
      init.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason as Error),
      ),
    );
  });

  const { result } = renderHook(() =>
    useClosedResults(new HttpPulseApi(), "p1"),
  );
  act(() => result.current.open());
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10000);
  expect(result.current.data.status).toBe("loading");

  act(() => deadlines.get("/api/polls/p1/ballot")?.abort());
  await waitFor(() =>
    expect(result.current.data).toEqual({
      status: "ready",
      value: { results: tally, yourChoices: [] },
    }),
  );
  expect(deadlines.has("/api/polls/p1/results")).toBe(true);
});
