import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPublicPollImage, publicPollImage } from "../src/images/public.js";
import { mayServe } from "../src/images/visibility.js";

const ID = "0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f";
const OTHER = "1c9a5d2f-6e8b-4f3c-8d4e-2b3c4d5e6f70";

test("a_pending_picture_is_served_to_nobody", () => {
  const pending = { id: ID, ownerKind: null, ownerId: null };
  assert.equal(mayServe(pending, undefined), false);
  assert.equal(
    mayServe(pending, { kind: "poll", currentImageId: ID, visible: true }),
    false,
  );
});

test("a_poll_picture_is_served_while_it_is_the_visible_polls_current_one", () => {
  const image = { id: ID, ownerKind: "poll" as const, ownerId: "p1" };
  assert.equal(
    mayServe(image, { kind: "poll", currentImageId: ID, visible: true }),
    true,
  );
  // Hidden poll.
  assert.equal(
    mayServe(image, { kind: "poll", currentImageId: ID, visible: false }),
    false,
  );
  // Replaced or removed.
  assert.equal(
    mayServe(image, { kind: "poll", currentImageId: OTHER, visible: true }),
    false,
  );
  assert.equal(
    mayServe(image, { kind: "poll", currentImageId: null, visible: true }),
    false,
  );
  // Owner gone, or of another kind.
  assert.equal(mayServe(image, undefined), false);
  assert.equal(
    mayServe(image, { kind: "community", defaultImageId: ID }),
    false,
  );
});

test("a_community_picture_is_served_only_while_it_is_the_current_default", () => {
  const image = { id: ID, ownerKind: "community" as const, ownerId: "campus" };
  assert.equal(
    mayServe(image, { kind: "community", defaultImageId: ID }),
    true,
  );
  assert.equal(
    mayServe(image, { kind: "community", defaultImageId: null }),
    false,
  );
  assert.equal(
    mayServe(image, { kind: "community", defaultImageId: OTHER }),
    false,
  );
  assert.equal(
    mayServe(image, { kind: "poll", currentImageId: ID, visible: true }),
    false,
  );
});

test("the_public_image_is_the_tile_or_exactly_the_upload_fields", () => {
  assert.deepEqual(publicPollImage(undefined), { kind: "tile" });
  const upload = publicPollImage({
    id: ID,
    width: 1600,
    height: 900,
    alt: "A garden",
    // Anything else a store carried is not copied.
    uploadedBy: "account-private",
  } as never);
  assert.deepEqual(upload, {
    kind: "upload",
    displayUrl: `/api/poll-images/${ID}/display.webp`,
    thumbUrl: `/api/poll-images/${ID}/thumb.webp`,
    width: 1600,
    height: 900,
    alt: "A garden",
  });
});

test("a_stored_public_image_is_copied_by_name_and_a_missing_one_is_the_tile", () => {
  assert.deepEqual(copyPublicPollImage(undefined), { kind: "tile" });
  const stored = {
    ...publicPollImage({ id: ID, width: 10, height: 20, alt: "x" }),
    extra: "private",
  } as never;
  assert.deepEqual(Object.keys(copyPublicPollImage(stored)).sort(), [
    "alt",
    "displayUrl",
    "height",
    "kind",
    "thumbUrl",
    "width",
  ]);
});
