import { useState } from "react";
import { DecisionDialog } from "../components/DecisionDialog.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import type { PreviewState, Scenario } from "../flow/chat-preview.js";
import {
  isPreviewState,
  PREVIEW_STATES,
  previewSender,
  SAMPLE_CONVERSATION,
  scenarioFor,
} from "../flow/chat-preview.js";
import { accessTo, choiceLabel, openerLabel } from "../flow/decision.js";
import { usePreviewSubmit } from "../hooks/use-preview-submit.js";
import "./ChatPreview.css";

/** How long a pretend send takes: long enough to see "Sending…". */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 600));
}

/**
 * A prototype (#228): a decision asked inside a conversation, answered in a
 * popup.
 *
 * Sample data only. Nothing here talks to the server, and the page says so
 * twice - once at the top, once in the confirmation - because a prototype
 * that looks like a working vote is a prototype someone will think they voted
 * in.
 *
 * `wait` is the pretend send's delay, handed in so a test can hold a send
 * open or let it through at once.
 */
export function ChatPreview({ wait = pause }: { wait?: () => Promise<void> }) {
  const [state, setState] = useState<PreviewState>("eligible");

  return (
    <main className="chatpreview">
      <ScreenFrame>
        <div className="chatpreview__body">
          <header className="chatpreview__head">
            <p className="chatpreview__badge">Preview</p>
            <h1 className="chatpreview__title">Answering in a conversation</h1>
            <p className="chatpreview__lede">
              A prototype with sample messages. Nothing you do here is sent or
              saved.
            </p>
            <label className="chatpreview__pick">
              Preview state
              <select
                className="chatpreview__select"
                value={state}
                onChange={(event) => {
                  if (isPreviewState(event.target.value))
                    setState(event.target.value);
                }}
              >
                {PREVIEW_STATES.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {/*
           * Keyed by the state, so switching it starts the conversation over:
           * no answer, no pick, and a send that fails first fails first again.
           */}
          <Conversation key={state} scenario={scenarioFor(state)} wait={wait} />
        </div>
      </ScreenFrame>
    </main>
  );
}

function Conversation({
  scenario,
  wait,
}: {
  scenario: Scenario;
  wait: () => Promise<void>;
}) {
  const { decision } = scenario;
  /* Made once per conversation, so its count of attempts survives renders. */
  const [send] = useState(() => previewSender(scenario.failFirst, wait));
  const { state: progress, submit, reset } = usePreviewSubmit(send);
  const [open, setOpen] = useState(false);
  /** What is ticked in the popup. Only becomes an answer once it is sent. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The answer the conversation shows - set only by a send that landed. */
  const [answer, setAnswer] = useState<string | null>(null);
  const access = accessTo(decision, scenario.eligibility);
  const answerLabel = choiceLabel(decision, answer);
  const sentLabel =
    progress.status === "sent"
      ? choiceLabel(decision, progress.choiceId)
      : null;

  function openDecision() {
    setPicked(answer);
    setOpen(true);
  }

  /*
   * Every way out of the popup comes through here. Only a send that landed
   * becomes the answer; anything picked and not sent is dropped, and a send
   * still on its way is forgotten by `reset`.
   */
  function closeDecision() {
    if (progress.status === "sent") setAnswer(progress.choiceId);
    reset();
    setOpen(false);
  }

  return (
    <>
      <ol className="chat" aria-label="Conversation">
        {SAMPLE_CONVERSATION.map((message) => (
          <li key={message.id} className="chat__msg">
            <span className="chat__author">{message.author}</span>
            {message.kind === "text" ? (
              <p className="chat__bubble">{message.text}</p>
            ) : (
              <div className="chat__card">
                <p className="chat__eyebrow">
                  {decision.open ? "DECISION" : "DECISION · CLOSED"}
                </p>
                <p className="chat__question">{decision.question}</p>
                <button
                  type="button"
                  className="chat__open"
                  onClick={openDecision}
                >
                  {openerLabel(access, answer !== null)}
                </button>
              </div>
            )}
          </li>
        ))}
        {answerLabel !== null ? (
          <li className="chat__msg chat__msg--mine">
            <span className="chat__author">You</span>
            <p className="chat__bubble chat__bubble--mine">
              My answer: {answerLabel}
            </p>
            {decision.privacy === "private" ? (
              <span className="chat__aside">Only you can see this.</span>
            ) : null}
          </li>
        ) : null}
      </ol>

      <DecisionDialog
        decision={decision}
        open={open}
        access={access}
        picked={picked}
        progress={progress}
        onPick={setPicked}
        onSubmit={submit}
        onClose={closeDecision}
        doneLabel="Back to the conversation"
        confirmation={
          <>
            <p className="chatpreview__proto">Prototype only</p>
            <p className="chatpreview__said">
              You picked <b>{sentLabel}</b>. This is a preview, so nothing was
              sent or recorded.
            </p>
          </>
        }
      />
    </>
  );
}
