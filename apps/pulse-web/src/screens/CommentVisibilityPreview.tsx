import { useState } from "react";
import {
  REFERENCE_CHOICES,
  SAMPLE_COMMENTS,
  commentsWithStance,
  randomSample,
  visibleComments,
} from "../flow/comment-visibility.js";
import type {
  ReferenceChoice,
  SampleComment,
} from "../flow/comment-visibility.js";
import "./CommentVisibilityPreview.css";

function CommentList({
  comments,
  empty,
}: {
  comments: readonly SampleComment[];
  empty: string;
}) {
  return comments.length === 0 ? (
    <p className="comment-preview__empty">{empty}</p>
  ) : (
    <ol className="comment-preview__comments">
      {comments.map((comment) => (
        <li key={comment.id}>
          <p>{comment.text}</p>
          <small>Sample comment by {comment.author}</small>
        </li>
      ))}
    </ol>
  );
}

/** #424: an isolated comparison, not a ranking rule for live comments. */
export function CommentVisibilityPreview() {
  const [reference, setReference] = useState<ReferenceChoice>("Garden");
  const [random, setRandom] = useState(() => randomSample(SAMPLE_COMMENTS));
  const visible = visibleComments(SAMPLE_COMMENTS);
  const agreeing = commentsWithStance(SAMPLE_COMMENTS, reference, "support");
  const opposing = commentsWithStance(SAMPLE_COMMENTS, reference, "oppose");

  return (
    <main className="comment-preview">
      <div className="comment-preview__shell">
        <p className="comment-preview__badge">Sample prototype</p>
        <h1>What if different opinions had equal space?</h1>
        <p>
          Compare three views of invented comments about an unused lot with the
          original chronological thread. This page does not read real comments,
          votes or accounts, and nothing here is posted or saved.
        </p>
        <label className="comment-preview__reference">
          Reference viewpoint
          <select
            value={reference}
            onChange={(event) =>
              setReference(event.target.value as ReferenceChoice)
            }
          >
            {REFERENCE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                Support {choice}
              </option>
            ))}
          </select>
        </label>
        <p className="comment-preview__note">
          Agreeing and opposing mean an explicit stance in this sample toward
          the selected option. A mixed or uncertain comment appears in the
          chronological thread and may appear in the random sample. These labels
          never infer anyone’s vote. One moderated sample is excluded from every
          view.
        </p>
        <div
          className="comment-preview__views"
          aria-label="Equal visibility comparison"
        >
          <section aria-labelledby="comment-preview-agree">
            <h2 id="comment-preview-agree">Agreeing with {reference}</h2>
            <p>{agreeing.length} sample comments</p>
            <CommentList
              comments={agreeing}
              empty={`No sample comments explicitly support ${reference}.`}
            />
          </section>
          <section aria-labelledby="comment-preview-oppose">
            <h2 id="comment-preview-oppose">Opposing {reference}</h2>
            <p>{opposing.length} sample comments</p>
            <CommentList
              comments={opposing}
              empty={`No sample comments explicitly oppose ${reference}.`}
            />
          </section>
          <section aria-labelledby="comment-preview-random">
            <h2 id="comment-preview-random">Random sample</h2>
            <p>Three visible comments, regardless of stance</p>
            <button
              type="button"
              onClick={() =>
                setRandom(
                  randomSample(
                    SAMPLE_COMMENTS,
                    random.map((one) => one.id),
                  ),
                )
              }
            >
              Shuffle sample
            </button>
            <CommentList
              comments={random}
              empty="No visible comments to sample."
            />
          </section>
        </div>
        <section
          className="comment-preview__baseline"
          aria-labelledby="comment-preview-thread"
        >
          <h2 id="comment-preview-thread">Original chronological thread</h2>
          <p>
            All {visible.length} visible sample comments stay available in their
            original order. The three views above change what is prominent, not
            what was said or how anyone voted.
          </p>
          <CommentList comments={visible} empty="No visible sample comments." />
        </section>
      </div>
    </main>
  );
}
