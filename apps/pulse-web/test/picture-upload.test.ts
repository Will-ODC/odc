import { afterEach, expect, it, vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import { uploadProblem } from "../src/hooks/picture-upload-errors.js";

const MiB = 1024 * 1024;
const id = "0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f";
const photo = new File(["photo"], "park.jpg", { type: "image/jpeg" });
const network =
  "The picture did not upload. Check your connection, then try again. Everything else you wrote is kept.";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
