import { afterEach, expect, it, vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import { ApiError } from "../src/api/types.js";
import { uploadProblem } from "../src/hooks/picture-upload-errors.js";

const MiB = 1024 * 1024;
const id = "0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f";
const photo = new File(["photo"], "park.jpg", { type: "image/jpeg" });
const network =
  "The picture did not upload. Check your connection, then try again. Everything else you wrote is kept.";
const saveNetwork =
  "The picture did not upload. Check your connection, then try again.";
const saveUnavailable =
  "Pulse cannot take pictures right now. Try again later.";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  ["images_unavailable", saveUnavailable, true],
  ["too_many_requests", saveUnavailable, true],
  [
    "upload_limit",
    "You have uploaded 20 pictures in the last hour, the most allowed. Try again in 2 minutes.",
    undefined,
  ],
  [
    "pending_limit",
    "You have 5 unused pictures, the most allowed at once. Unused pictures clear after a day. Try again tomorrow.",
    undefined,
  ],
  ["network", saveNetwork, true],
  [
    "image_busy",
    "Pulse is busy with other pictures. Try again in a minute.",
    true,
  ],
  [undefined, saveNetwork, true],
] as const)("uses save copy for %s", (code, message, retry) => {
  const error = code ? new ApiError(429, "Refused", code, 61) : new Error();
  const problem = uploadProblem(error, photo, undefined, "save");
  expect(problem.message).toBe(message);
  expect(problem.retry).toBe(retry);
});

it("defaults to post copy", () => {
  expect(uploadProblem(new Error(), photo, undefined)).toEqual({
    message: network,
    retry: true,
  });
});

it("uploads the raw file without AbortSignal.any and cleans up after success", async () => {
  vi.useFakeTimers();
  const signalType = AbortSignal;
  vi.stubGlobal("AbortSignal", { any: undefined });
  const caller = new AbortController();
  const fetchUpload = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ image: { id } }, { status: 201 }));
  const api = new HttpPulseApi("/api", fetchUpload);

  await expect(api.uploadPicture(photo, caller.signal)).resolves.toBe(id);
  expect(fetchUpload).toHaveBeenCalledExactlyOnceWith("/api/poll-images", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "image/jpeg" },
    signal: expect.any(signalType),
    body: photo,
  });
  caller.abort();
  expect(fetchUpload.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects a successful response with no readable picture id", async () => {
  const fetchUpload = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ image: {} }, { status: 201 }));
  const api = new HttpPulseApi("/api", fetchUpload);

  await expect(
    api.uploadPicture(photo, new AbortController().signal),
  ).rejects.toMatchObject({ status: 201 });
});

it.each([[true], [false]])(
  "forwards cancellation and clears the timer (already aborted: %s)",
  async (alreadyAborted) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    if (alreadyAborted) caller.abort();
    const fetchUpload = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        const signal = options?.signal;
        if (signal?.aborted) throw signal.reason;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
      });
    const api = new HttpPulseApi("/api", fetchUpload);
    const rejected = expect(
      api.uploadPicture(photo, caller.signal),
    ).rejects.toMatchObject({ status: 0 });
    if (!alreadyAborted) caller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([
  [0, 60_000],
  [0.5, 75_000],
  [4, 180_000],
  [10, 360_000],
  [11, 360_000],
])(
  "times out a %s MiB upload at %i ms and maps it to the network message",
  async (size, timeout) => {
    vi.useFakeTimers();
    const file = new File([new Uint8Array(size * MiB)], "park.jpg", {
      type: "image/jpeg",
    });
    const fetchUpload = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const api = new HttpPulseApi("/api", fetchUpload);
    const problem = api
      .uploadPicture(file, new AbortController().signal)
      .catch((error: unknown) => uploadProblem(error, file, undefined));
    const signal = fetchUpload.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await expect(problem).resolves.toEqual({ message: network, retry: true });
    expect(vi.getTimerCount()).toBe(0);
  },
);
