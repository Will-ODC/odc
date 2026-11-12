import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, test, type TestContext } from "node:test";
import { CreationError, PURPOSE_VERSION } from "../../src/authoring/input.js";
import type { CreationStore } from "../../src/authoring/store.js";
import type { VoterStore } from "../../src/identity/store.js";
import type { ProcessedImage } from "../../src/images/process.js";
import { ImageStoreError, type ImageStore } from "../../src/images/store.js";
import type { VotingStore } from "../../src/voting/store.js";

export const AT = new Date("2026-11-12T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const ACCOUNTS = {
  member: { id: "acct-member-private", community: "campus" },
  other: { id: "acct-other-private", community: "campus" },
  owner: { id: "acct-owner-private", community: null },
} as const;
export const OWNER_EMAIL = "acct-owner-private@example.test";
const member = { voterId: ACCOUNTS.member.id, sessionGeneration: 0 };
const other = { voterId: ACCOUNTS.other.id, sessionGeneration: 0 };
const owner = { voterId: ACCOUNTS.owner.id, sessionGeneration: 0 };

export interface ImageFixture {
  images: ImageStore;
  creation: CreationStore;
  voting: VotingStore;
  voters: VoterStore;
  setTime(time: Date): void;
}

/** Add the three accounts to a fresh voter store. */
export async function addAccounts(voters: VoterStore): Promise<void> {
  for (const account of Object.values(ACCOUNTS))
    await voters.create(
      {
        id: account.id,
        community: account.community,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${account.id}@example.test`, verifiedAt: AT },
    );
}

/** A processed picture with distinct bytes; the store never decodes them. */
function processed(): ProcessedImage {
  const variant = () => {
    const bytes = randomBytes(64);
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  return { width: 640, height: 480, display: variant(), thumb: variant() };
}

function question(image?: { id: string; alt: string }) {
  return {
    question: "Plant a garden?",
    choices: ["Yes", "No"],
    method: "single",
    purposeAcknowledgement: PURPOSE_VERSION,
    ...(image ? { image } : {}),
  };
}

async function refusedWith(
  promise: Promise<unknown>,
  code: ImageStoreError["code"],
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ImageStoreError && error.code === code,
  );
}

async function unavailable(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof CreationError && error.code === "image_unavailable",
  );
}

/**
 * The picture store's behaviour, which every implementation must share
 * (ADR-0047 sections 1, 2, 4 and 11). Attaching runs through the creation
 * store, as it does over HTTP.
 */
export function imageStoreConformance(
  name: string,
  fresh: (t: TestContext) => Promise<ImageFixture>,
  options: { skip?: string | false } = {},
): void {
  describe(
    `ImageStore conformance: ${name}`,
    { skip: options.skip ?? false },
    () => {
      test("a_pending_picture_is_served_to_nobody", async (t) => {
        const f = await fresh(t);
        const saved = await f.images.savePending(member, processed());
        assert.deepEqual(Object.keys(saved).sort(), ["height", "id", "width"]);
        assert.match(saved.id, /^[0-9a-f-]{36}$/);
        assert.equal(await f.images.servable(saved.id, "display"), undefined);
        assert.equal(await f.images.servable(saved.id, "thumb"), undefined);
      });

      test("attaching_through_publication_serves_both_variants_and_names_the_picture", async (t) => {
        const f = await fresh(t);
        const image = processed();
        const saved = await f.images.savePending(member, image);
        const { poll } = await f.creation.publish(
          member,
          randomUUID(),
          question({ id: saved.id, alt: "  A sunny plot  " }),
        );
        assert.deepEqual(poll.image, {
          kind: "upload",
          displayUrl: `/api/poll-images/${saved.id}/display.webp`,
          thumbUrl: `/api/poll-images/${saved.id}/thumb.webp`,
          width: 640,
          height: 480,
          alt: "A sunny plot",
        });
        assert.deepEqual((await f.voting.getPoll(poll.id))?.image, {
          id: saved.id,
          width: 640,
          height: 480,
          alt: "A sunny plot",
        });
        const display = await f.images.servable(saved.id, "display");
        const thumb = await f.images.servable(saved.id, "thumb");
        assert.ok(display && thumb);
        assert.ok(display.bytes.equals(image.display.bytes));
        assert.equal(display.sha256, image.display.sha256);
        assert.ok(thumb.bytes.equals(image.thumb.bytes));
        // The listing names the same picture without another read.
        const rows = await f.voting.listPolls({
          community: "campus",
          limit: 10,
        });
        assert.deepEqual(rows[0]?.image, {
          id: saved.id,
          width: 640,
          height: 480,
          alt: "A sunny plot",
        });
        // Nothing private on the public body.
        assert.doesNotMatch(
          JSON.stringify(poll),
          /acct-|example\.test|uploaded/,
        );
      });

      test("a_poll_without_a_picture_has_none_and_reads_as_the_tile", async (t) => {
        const f = await fresh(t);
        const { poll } = await f.creation.publish(
          member,
          randomUUID(),
          question(),
        );
        assert.deepEqual(poll.image, { kind: "tile" });
        assert.equal((await f.voting.getPoll(poll.id))?.image, undefined);
      });

      test("only_the_uploader_may_attach_and_only_once", async (t) => {
        const f = await fresh(t);
        const saved = await f.images.savePending(member, processed());
        await unavailable(
          f.creation.publish(
            other,
            randomUUID(),
            question({ id: saved.id, alt: "x" }),
          ),
        );
        await unavailable(
          f.creation.publish(
            member,
            randomUUID(),
            question({ id: randomUUID(), alt: "x" }),
          ),
        );
        // A refused publication wrote nothing.
        assert.deepEqual(
          await f.voting.listPolls({ community: "campus", limit: 10 }),
          [],
        );
        await f.creation.publish(
          member,
          randomUUID(),
          question({ id: saved.id, alt: "x" }),
        );
        await unavailable(
          f.creation.publish(
            member,
            randomUUID(),
            question({ id: saved.id, alt: "x" }),
          ),
        );
        assert.equal(
          (await f.voting.listPolls({ community: "campus", limit: 10 })).length,
          1,
        );
      });

      test("a_replay_returns_the_first_publication_and_attaches_nothing_twice", async (t) => {
        const f = await fresh(t);
        const saved = await f.images.savePending(member, processed());
        const key = randomUUID();
        const body = question({ id: saved.id, alt: "Plot" });
        const first = await f.creation.publish(member, key, body);
        const again = await f.creation.publish(member, key, body);
        assert.equal(again.replayed, true);
        assert.deepEqual(again.poll, first.poll);
        assert.equal(
          (await f.voting.listPolls({ community: "campus", limit: 10 })).length,
          1,
        );
        // The picture id is part of the canonical input: another picture under
        // the same key is a conflict, not a second attachment.
        const second = await f.images.savePending(member, processed());
        await assert.rejects(
          f.creation.publish(
            member,
            key,
            question({ id: second.id, alt: "Plot" }),
          ),
          (error: unknown) =>
            error instanceof CreationError &&
            error.code === "idempotency_conflict",
        );
      });

      test("a_pending_picture_expires_after_24_hours_and_cannot_be_attached", async (t) => {
        const f = await fresh(t);
        const saved = await f.images.savePending(member, processed());
        f.setTime(new Date(AT.getTime() + DAY));
        // Not yet swept, still refused: the 24 hours are the rule, not the sweep.
        await unavailable(
          f.creation.publish(
            member,
            randomUUID(),
            question({ id: saved.id, alt: "x" }),
          ),
        );
      });

      test("the_sweep_deletes_pending_pictures_24_hours_old_and_never_attached_ones", async (t) => {
        const f = await fresh(t);
        const attached = await f.images.savePending(member, processed());
        await f.creation.publish(
          member,
          randomUUID(),
          question({ id: attached.id, alt: "kept" }),
        );
        const pending = await f.images.savePending(member, processed());
        f.setTime(new Date(AT.getTime() + DAY - 1));
        assert.equal(await f.images.sweepPending(), 0);
        f.setTime(new Date(AT.getTime() + DAY));
        assert.equal(await f.images.sweepPending(), 1);
        assert.equal(await f.images.sweepPending(), 0);
        assert.ok(await f.images.servable(attached.id, "display"));
        assert.equal(await f.images.servable(pending.id, "display"), undefined);
        // The swept picture no longer counts toward the pending limit.
        for (let n = 0; n < 5; n++)
          await f.images.savePending(member, processed());
      });

      test("five_pending_pictures_is_the_most_one_account_holds", async (t) => {
        const f = await fresh(t);
        const ids: string[] = [];
        for (let n = 0; n < 5; n++)
          ids.push((await f.images.savePending(member, processed())).id);
        await refusedWith(f.images.checkAllowance(member), "pending_limit");
        await refusedWith(
          f.images.savePending(member, processed()),
          "pending_limit",
        );
        // Another account is unaffected.
        await f.images.checkAllowance(other);
        // Attaching one frees a slot.
        await f.creation.publish(
          member,
          randomUUID(),
          question({ id: ids[0] as string, alt: "x" }),
        );
        await f.images.checkAllowance(member);
        await f.images.savePending(member, processed());
      });

      test("twenty_uploads_in_a_rolling_hour_is_the_most_with_a_retry_time", async (t) => {
        const f = await fresh(t);
        // The owner posts without the hourly posting limit, so twenty pictures
        // can be attached and none stays pending.
        for (let n = 0; n < 20; n++) {
          f.setTime(new Date(AT.getTime() + n * 1000));
          const saved = await f.images.savePending(owner, processed());
          await f.creation.publish(
            owner,
            randomUUID(),
            question({ id: saved.id, alt: `n${n}` }),
          );
        }
        f.setTime(new Date(AT.getTime() + 20_000));
        await assert.rejects(
          f.images.savePending(owner, processed()),
          (error: unknown) =>
            error instanceof ImageStoreError &&
            error.code === "upload_limit" &&
            error.retryAfter === HOUR / 1000 - 20,
        );
        await refusedWith(f.images.checkAllowance(owner), "upload_limit");
        // The first upload leaves the hour exactly at its boundary.
        f.setTime(new Date(AT.getTime() + HOUR));
        await f.images.savePending(owner, processed());
      });

      test("a_stale_session_generation_is_signed_out", async (t) => {
        const f = await fresh(t);
        const stale = { voterId: member.voterId, sessionGeneration: 1 };
        await refusedWith(f.images.checkAllowance(stale), "signed_out");
        await refusedWith(
          f.images.savePending(stale, processed()),
          "signed_out",
        );
        await refusedWith(
          f.images.savePending(
            { voterId: "nobody", sessionGeneration: 0 },
            processed(),
          ),
          "signed_out",
        );
      });

      test("an_unknown_picture_is_not_servable", async (t) => {
        const f = await fresh(t);
        assert.equal(
          await f.images.servable(randomUUID(), "display"),
          undefined,
        );
      });
    },
  );
}
