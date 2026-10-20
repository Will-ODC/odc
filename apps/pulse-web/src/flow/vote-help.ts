import type { VoteCardStatus } from "../components/VoteCard.js";

/** Copy follows the card's actual state; guidance never advances the ballot. */
export function guideFor(
  visible: boolean,
  collapsed: boolean,
  kind: VoteCardStatus["kind"],
  picked: boolean,
  next: boolean,
) {
  if (!visible || collapsed)
    return {
      selector: '[data-guide="open"]',
      text: "Open the vote card.",
      finished: false,
    };
  if (kind === "answered")
    return {
      selector: ".results",
      text:
        "Your answer is saved. Read results or change your answer until close." +
        (next ? " Next opens a linked question." : ""),
      finished: true,
    };
  if (kind === "closed")
    return {
      selector: ".vote-card",
      text: "Voting has closed. You can read the results.",
      finished: true,
    };
  if (kind === "unconfirmed")
    return {
      selector: ".vote-card",
      text: "You need confirmation before answering this question.",
      finished: true,
    };
  if (kind === "sending")
    return {
      selector: ".vote-card__submit",
      text: "Your answer is being sent. Please wait.",
      finished: false,
    };
  if (kind === "failed")
    return {
      selector: ".vote-card__submit",
      text: "Your answer was not saved. Press Try again to retry.",
      finished: false,
    };
  return picked
    ? {
        selector: ".vote-card__submit",
        text: "Press Submit to save your answer.",
        finished: false,
      }
    : {
        selector: ".vote-card__choices",
        text: "Choose your answer. Nothing is sent yet.",
        finished: false,
      };
}
