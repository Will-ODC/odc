// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { HttpContributionsApi } from "../src/api/contributions.js";
import { contributionFixture as fixture } from "./contributions-fixtures.js";

it("rejects malformed successful responses and sends credentials/idempotency keys", async () => {
  const doFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ contribution: {} })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ contribution: fixture(), replayed: false }),
      ),
    );
  const api = new HttpContributionsApi(doFetch);
  await expect(api.detail("park")).rejects.toThrow("could not be read");
  await api.participate(
    "park",
    { kind: "help", displayName: "Helper", message: "Help" },
    "request-key",
    "helper",
  );
  expect(doFetch.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    headers: { "Idempotency-Key": "request-key" },
  });
});

it("reads public-profile and owner contribution pages from separate endpoints", async () => {
  const doFetch = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ contributions: [fixture()], nextCursor: null }),
        ),
    );
  const api = new HttpContributionsApi(doFetch);
  await api.forProfile("public/id", "next page");
  await api.mine();
  await api.mine("next page", "account/1");
  expect(doFetch.mock.calls[0]?.[0]).toBe(
    "/api/profiles/public%2Fid/contributions?cursor=next%20page",
  );
  expect(doFetch.mock.calls[1]?.[0]).toBe("/api/me/contributions");
  expect(doFetch.mock.calls[1]?.[1]).toMatchObject({
    method: "GET",
    credentials: "same-origin",
  });
  expect(doFetch.mock.calls[2]?.[0]).toBe(
    "/api/me/contributions?cursor=next%20page&ownerAccountId=account%2F1",
  );
});

it("uses load wording for GET failures and save wording for writes", async () => {
  const doFetch = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("{}", { status: 500 }));
  const api = new HttpContributionsApi(doFetch);
  await expect(api.list()).rejects.toThrow("Could not load this. Try again.");
  await expect(api.detail("park")).rejects.toThrow(
    "Could not load this. Try again.",
  );
  await expect(api.messages("park")).rejects.toThrow(
    "Could not load this. Try again.",
  );
  await expect(
    api.create(
      {
        kind: "project",
        title: "Park",
        description: "Fix the park.",
        organizerName: "Ada",
      },
      crypto.randomUUID(),
      "helper",
    ),
  ).rejects.toThrow("Could not save this change. Please try again.");
  await expect(
    api.participate(
      "park",
      { displayName: "Jo", kind: "help", message: "I can help." },
      crypto.randomUUID(),
      "helper",
    ),
  ).rejects.toThrow("Could not save this change. Please try again.");
});

it("says what a refused entry means for each conflict code", async () => {
  const refuse = (error: string) =>
    new HttpContributionsApi(
      async () => new Response(JSON.stringify({ error }), { status: 409 }),
    ).participate(
      "park",
      { displayName: "Jo", kind: "help", message: "I can help." },
      crypto.randomUUID(),
      "helper",
    );
  await expect(refuse("sender_limit")).rejects.toThrow(
    "You have added as many entries to this contribution as one person can.",
  );
  await expect(refuse("closed")).rejects.toThrow(
    "This contribution is closed to new offers of help and pledges.",
  );
  await expect(refuse("record_full")).rejects.toThrow(
    "This contribution has reached its entry limit.",
  );
  await expect(refuse("idempotency_conflict")).rejects.toThrow(
    "This contribution has changed. Reload it before trying again.",
  );
});

it("sends the page account on every write and preserves account_changed as a distinct refusal", async () => {
  const doFetch = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: "account_changed" }), {
        status: 409,
      }),
  );
  const api = new HttpContributionsApi(doFetch);
  const calls = [
    () =>
      api.create(
        {
          title: "Garden",
          description: "Build",
          organizerName: "Ada",
          kind: "project",
        },
        "key",
        "ada",
      ),
    () =>
      api.participate(
        "park",
        { displayName: "Ada", kind: "help", message: "Build" },
        "key",
        "ada",
      ),
    () => api.sendMessage("park", "Private", "key", "ada"),
    () =>
      api.update(
        "park",
        { message: "Done", status: "completed" },
        "key",
        "ada",
      ),
  ];
  for (const send of calls)
    await expect(send()).rejects.toMatchObject({
      status: 409,
      code: "account_changed",
      message: "Your account changed, so this wasn't sent.",
    });
  for (const [, init] of doFetch.mock.calls)
    expect(JSON.parse(String(init?.body)).accountId).toBe("ada");
});
