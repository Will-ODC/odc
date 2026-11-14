import assert from "node:assert/strict";
import { test } from "node:test";
import { createPoll, type Publication } from "../src/voting/poll.js";
import {
  publicPoll,
  publicPollReplay,
  type PublishedPublicPoll,
} from "../src/voting/public-poll.js";

const AT = new Date("2026-10-20T12:00:00.000Z");
const poll = createPoll(
  { id: "p", question: "Q", choices: ["A", "B"], method: "single" },
  AT,
);

test("a_poll_without_a_publication_has_only_public_keys_and_null_context", () => {
  assert.deepEqual(Object.keys(publicPoll(poll, AT)), [
    "id",
    "question",
    "context",
    "choices",
    "method",
    "next",
    "acceptsSuggestions",
    "closesAt",
    "open",
    "image",
  ]);
  assert.deepEqual(publicPoll(poll, AT), {
    id: "p",
    question: "Q",
    context: null,
    choices: ["A", "B"],
    method: "single",
    next: [null, null],
    acceptsSuggestions: false,
    closesAt: null,
    open: true,
    image: { kind: "tile" },
  });
});

test("an_unknown_attribution_kind_is_refused_not_published_as_anonymous", () => {
  const publication = {
    community: { id: "pulse-general", label: "General" },
    attribution: { kind: "verified", accountId: "author-account" },
  } as unknown as Publication;
  assert.throws(() => publicPoll({ ...poll, publication }, AT), TypeError);
});

test("the_projection_shares_no_mutable_state_with_the_stored_poll", () => {
  const publication: Publication = {
    community: { id: "campus", label: "Campus" },
    attribution: { kind: "named", name: "Ada" },
  };
  const read = publicPoll({ ...poll, publication }, AT);
  read.community!.label = "changed";
  read.choices.push("C");
  assert.equal(publication.community.label, "Campus");
  assert.deepEqual(poll.choices, ["A", "B"]);
});

const saved: PublishedPublicPoll = {
  id: "p",
  question: "Q",
  context: "Background\n<b>literal</b>",
  choices: ["A", "B"],
  method: "single",
  next: [null, null],
  acceptsSuggestions: false,
  closesAt: "2026-10-27T12:00:00.000Z",
  open: true,
  image: {
    kind: "upload",
    displayUrl:
      "/api/poll-images/00000000-0000-4000-8000-000000000000/display.webp",
    thumbUrl:
      "/api/poll-images/00000000-0000-4000-8000-000000000000/thumb.webp",
    width: 640,
    height: 480,
    alt: "Plot",
  },
  community: { id: "campus", label: "Campus" },
  attribution: { kind: "named", name: "Ada" },
};

test("a_replayed_creation_response_keeps_its_picture_and_context", () => {
  assert.deepEqual(publicPollReplay(structuredClone(saved)), saved);
});

test("a_replayed_creation_response_saved_before_pictures_and_context_reads_as_tile_and_null", () => {
  const { image: _image, context: _context, ...legacy } = saved;
  void _image;
  void _context;
  assert.deepEqual(publicPollReplay(legacy), {
    ...legacy,
    context: null,
    image: { kind: "tile" },
  });
});

test("a_replayed_creation_response_drops_fields_it_does_not_name", () => {
  const extra = {
    ...structuredClone(saved),
    createdBy: "author-account",
    image: { ...saved.image, uploader: "author-account" },
  } as unknown as PublishedPublicPoll;
  assert.doesNotMatch(
    JSON.stringify(publicPollReplay(extra)),
    /author-account|createdBy|uploader/,
  );
});
