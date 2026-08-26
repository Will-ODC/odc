import { useState } from "react";
import type { FormEvent } from "react";
import type { Poll, PulseApi, Suggestion } from "../api/types.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import { edgesOf, useNextQuestions } from "../hooks/use-next-questions.js";
import { useSuggestions } from "../hooks/use-suggestions.js";
import { BallotChrome } from "../components/BallotChrome.js";
import { Outcome } from "../components/Outcome.js";
import { Refusal } from "../components/Refusal.js";
import "./SwipeBallot.css";
import "./ChoiceBallot.css";

export interface ChoiceBallotProps {
  api: PulseApi;
  /** More than two choices. `App` picks this screen for those. */
  poll: Poll;
  onAnswered: (next: string | null) => void;
  /** Absent on the first question of a run - see `BallotChrome`. */
  onBack?: (() => void) | undefined;
}

/**
 * A question with more answers than a swipe can hold.
 *
 * One press is one vote, the same as a swipe: the run is meant to move at the
 * speed of an opinion, and a pick-then-confirm pair on every question would
 * double every press in it. What keeps that safe is that an answer can be
 * changed until the question closes, and the screen says so.
 *
 * Below the answers, where the poll allows it, is the way to say something the
 * poll did not think of.
 */
export function ChoiceBallot({
  api,
  poll,
  onAnswered,
  onBack,
}: ChoiceBallotProps) {
  const { state, cast } = useCastVote(api, poll.id);
  const nextQuestions = useNextQuestions(api, edgesOf(poll.next));

  const settled =
    state.status === "casting" ||
    state.status === "counted" ||
    state.status === "closed";
  const chosen =
    state.status === "casting" || state.status === "counted"
      ? state.choice
      : null;

  return (
    <section className="ballot ballot--list">
      <div className="ballot__content">
        <BallotChrome poll={poll} {...(onBack ? { onBack } : {})} />
        {state.status === "failed" ? <Refusal message={state.message} /> : null}

        {settled ? (
          <div className="ballot__done">
            <Outcome
              state={state}
              label={chosen === null ? "" : (poll.choices[chosen] ?? "")}
              hasNext={chosen !== null && (poll.next[chosen] ?? null) !== null}
              nextQuestion={chosen === null ? undefined : nextQuestions[chosen]}
              onNext={() =>
                onAnswered(chosen === null ? null : (poll.next[chosen] ?? null))
              }
            />
          </div>
        ) : (
          <div className="choices">
            <ul className="choices__list">
              {poll.choices.map((label, index) => (
                <li key={label}>
                  <button
                    type="button"
                    className="choices__one"
                    onClick={() => {
                      if (!settled) cast(index);
                    }}
                  >
                    <span>{label}</span>
                    {nextQuestions[index] ? (
                      <span className="choices__next">
                        opens: {nextQuestions[index]}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            {poll.acceptsSuggestions ? (
              <AddYourOwn api={api} pollId={poll.id} />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Say something the poll did not offer.
 *
 * What comes back is shown quietly and in place - a line under the field, not
 * a dialogue in front of it. Being told that eleven other people already said
 * your idea should feel like being counted, not like being corrected.
 */
function AddYourOwn({ api, pollId }: { api: PulseApi; pollId: string }) {
  const { all, add, submit, reset } = useSuggestions(api, pollId);
  const [text, setText] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === "" || add.status === "sending") return;
    submit(text);
    setText("");
  }

  return (
    <div className="own">
      <form className="own__form" onSubmit={onSubmit}>
        <label className="own__label" htmlFor="own-idea">
          Something else?
        </label>
        <div className="own__row">
          <input
            id="own-idea"
            className="own__input"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (add.status !== "idle") reset();
            }}
            placeholder="Say it in your own words"
            autoComplete="off"
          />
          <button
            type="submit"
            className="own__add"
            disabled={text.trim() === "" || add.status === "sending"}
          >
            Add
          </button>
        </div>
      </form>

      {add.status === "failed" ? (
        <p className="own__said own__said--wrong" role="alert">
          {add.message}
        </p>
      ) : null}

      {add.status === "done" ? (
        <p className="own__said" role="status">
          {add.result.status === "seconded"
            ? `${add.result.suggestion.count} people have said that. Yours is with them.`
            : "Added. Nobody had said that yet."}
          {add.result.related.length > 0 ? (
            <span className="own__near">
              {" "}
              Close to: {add.result.related.map((one) => one.text).join("; ")}
            </span>
          ) : null}
        </p>
      ) : null}

      {all.length > 0 ? <Added all={all} /> : null}
    </div>
  );
}

function Added({ all }: { all: Suggestion[] }) {
  return (
    <div className="own__all">
      <p className="ballot__eyebrow">ALSO SAID</p>
      <ul>
        {all.map((one) => (
          <li key={one.id}>
            <span>{one.text}</span>
            <b>{one.count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
