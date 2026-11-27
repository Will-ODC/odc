import { expect, it, vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import { pictureChangedMessage } from "../src/api/pictures.js";

const id = "b4c9e661-7f81-4d79-a6bd-689851959651";
const input = { id, alt: "A bench by the path" };
const image = {
  kind: "upload",
  displayUrl: `/api/poll-images/${id}/display.webp`,
  thumbUrl: `/api/poll-images/${id}/thumb.webp`,
  width: 640,
  height: 480,
  alt: input.alt,
};
const tile = { kind: "tile" };
const path = "/api/polls/park%2Fpath/image";

it("reads the private permission and uses JSON PUT and a conditional bodyless DELETE", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ canManage: true }))
    .mockResolvedValueOnce(Response.json({ canManage: false }))
    .mockResolvedValueOnce(Response.json({ image }))
    .mockResolvedValueOnce(Response.json({ image: tile }));
  const api = new HttpPulseApi("/api/", fetch);

  await expect(api.pollPictureAccess("park/path")).resolves.toBe(true);
  await expect(api.pollPictureAccess("park/path")).resolves.toBe(false);
  await expect(api.changePollPicture("park/path", input)).resolves.toEqual(
    image,
  );
  await expect(
    api.changePollPicture("park/path", { expectedImageId: id }),
  ).resolves.toEqual(tile);

  expect(fetch).toHaveBeenNthCalledWith(1, path, {
    method: "GET",
    credentials: "same-origin",
    signal: expect.any(AbortSignal),
  });
  expect(fetch).toHaveBeenNthCalledWith(3, path, {
    method: "PUT",
    credentials: "same-origin",
    signal: expect.any(AbortSignal),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(fetch).toHaveBeenNthCalledWith(4, `${path}?expectedImageId=${id}`, {
    method: "DELETE",
    credentials: "same-origin",
    signal: expect.any(AbortSignal),
  });
});

it("rejects malformed permission and image responses", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ canManage: "true" }))
    .mockResolvedValueOnce(Response.json({ image: { ...image, alt: null } }));
  const api = new HttpPulseApi("/api", fetch);
  await expect(api.pollPictureAccess("park")).rejects.toMatchObject({
    status: 200,
  });
  await expect(api.changePollPicture("park", input)).rejects.toMatchObject({
    status: 0,
  });
});

it.each([
  [400, "bad_request"],
  [401, "signed_out"],
  [403, "poster_required"],
  [403, "origin_not_allowed"],
  [404, "not_found"],
  [409, "image_changed"],
  [413, "body_too_large"],
  [422, "image_unavailable"],
  [429, "too_many_requests"],
  [503, "images_unavailable"],
  [500, "server_error"],
] as const)(
  "keeps the %i %s refusal available to the editor",
  async (status, code) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: code, message: "Server picture message." },
          { status },
        ),
      );
    const api = new HttpPulseApi("/api", fetch);
    await expect(
      api.changePollPicture("park", { expectedImageId: id }),
    ).rejects.toMatchObject({
      status,
      code,
      ...(code === "image_changed" ? { message: pictureChangedMessage } : {}),
    });
  },
);
