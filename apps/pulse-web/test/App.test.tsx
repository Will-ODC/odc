// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import { App } from "../src/App.js";
import { graph, installPointerEvents, poll, stubApi } from "./stub-api.js";

beforeAll(installPointerEvents);
afterEach(cleanup);

describe("the four states", () => {
  it("says it is loading before the ballot arrives", () => {
    render(
      <App
        api={stubApi({ poll: () => new Promise(() => {}) })}
        pollId="ads-free"
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the question once it arrives", async () => {
    render(<App api={stubApi()} pollId="ads-free" />);
    expect(await screen.findByText(poll().question)).toBeTruthy();
  });

  it("says there is nothing to vote on when the poll is not there", async () => {
    const api = stubApi({
      poll: () =>
        Promise.reject(new ApiError(404, "no such poll", "not_found")),
    });
    render(<App api={api} pollId="ads-free" />);
    expect(
      await screen.findByText("There is nothing to vote on yet."),
    ).toBeTruthy();
  });

  it("shows one plain sentence when the ballot cannot be reached", async () => {
    const api = stubApi({
      poll: () => Promise.reject(new TypeError("offline")),
    });
    render(<App api={api} pollId="ads-free" />);
    expect(
      await screen.findByText(
        "We could not reach the ballot. Check your connection and try again.",
      ),
    ).toBeTruthy();
  });
});

describe("which ballot a question gets", () => {
  it("swipes a question with two answers", async () => {
    render(<App api={stubApi()} pollId="ads-free" />);
    await screen.findByText(poll().question);
    expect(document.querySelector(".ballot__split")).toBeTruthy();
  });

  it("lists a question with more than two answers", async () => {
    const listed = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: ["Members chip in", "Donations", "Grants"],
      next: [null, null, null],
    });
    render(
      <App api={stubApi({ poll: graph([listed]) })} pollId="pay-for-it" />,
    );

    await screen.findByText("How do we pay for it?");
    expect(document.querySelector(".ballot__split")).toBeNull();
    expect(screen.getByRole("button", { name: "Grants" })).toBeTruthy();
  });
});

describe("going back", () => {
  const first = poll({
    id: "ads-free",
    choices: ["No", "Yes"],
    next: ["ads-allowed", "pay-for-it"],
  });
  const paid = poll({
    id: "pay-for-it",
    question: "How do we pay for it?",
    choices: ["Members chip in", "Donations", "Grants"],
    next: [null, null, null],
  });
  const ads = poll({
    id: "ads-allowed",
    question: "Which ads are allowed?",
    choices: ["All of them", "Only voted-through ones", "Research only"],
    next: [null, null, null],
  });

  const showRun = () =>
    render(
      <App
        api={stubApi({ poll: graph([first, paid, ads]) })}
        pollId="ads-free"
      />,
    );

  /** Answer the opening question and walk on to the question it opened. */
  async function walkOn() {
    await screen.findByText(first.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", { name: /How do we pay for it\?/ }),
    );
    await screen.findByText(paid.question);
  }

  it("offers no way back on the question the run opened on", async () => {
    showRun();
    await screen.findByText(first.question);
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("offers a way back once a question has been walked past", async () => {
    showRun();
    await walkOn();
    expect(screen.getByRole("button", { name: /Back/ })).toBeTruthy();
  });

  it("does not cast a vote when an arrow key is pressed on Back", async () => {
    // The run has to reach a SWIPE screen with Back on it: only the swipe
    // ballot answers arrow keys, so a list screen would pass this test without
    // ever exercising the thing it is about.
    const opener = poll({
      id: "ads-free",
      choices: ["No", "Yes"],
      next: ["ads-allowed", "second-swipe"],
    });
    const secondSwipe = poll({
      id: "second-swipe",
      question: "Should members set the budget?",
      choices: ["No", "Yes"],
      next: [null, null],
    });
    const cast = vi.fn(stubApi().cast);
    render(
      <App
        api={stubApi({ poll: graph([opener, secondSwipe, ads]), cast })}
        pollId="ads-free"
      />,
    );

    await screen.findByText(opener.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Should members set the budget\?/,
      }),
    );
    await screen.findByText(secondSwipe.question);
    cast.mockClear();

    // Back is inside the section that answers arrow keys, and its own glyph is
    // a left chevron — so left arrow is the key someone is most likely to try
    // here, and it must not be read as answering the question.
    const back = screen.getByRole("button", { name: /Back/ });
    back.focus();
    fireEvent.keyDown(back, { key: "ArrowLeft" });
    fireEvent.keyDown(back, { key: "ArrowRight" });

    expect(cast).not.toHaveBeenCalled();
    // Still on the question, not moved on by a phantom vote.
    expect((await screen.findByRole("heading")).textContent).toBe(
      secondSwipe.question,
    );
  });

  it("returns to the question that was asked before", async () => {
    showRun();
    await walkOn();

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    // Asserted on the heading, not on the text being absent: the opening
    // question previews "How do we pay for it?" under its Yes side, so that
    // wording is legitimately on this screen. Which question is *being asked*
    // is the heading.
    expect((await screen.findByRole("heading")).textContent).toBe(
      first.question,
    );
  });

  it("asks the returned-to question again rather than showing the old answer", async () => {
    showRun();
    await walkOn();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    await screen.findByText(first.question);

    // The ballot is back, not the outcome: an answer can be changed until the
    // question closes, so the sides are the truthful thing to show.
    expect(document.querySelector(".ballot__split")).toBeTruthy();
    expect(screen.queryByText("Counted.")).toBeNull();
  });

  it("stops offering a way back once it has been walked to the start", async () => {
    showRun();
    await walkOn();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    await screen.findByText(first.question);

    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("goes back a step at a time rather than jumping to the start", async () => {
    const middle = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: ["Members chip in", "Donations", "Grants"],
      next: ["ads-allowed", null, null],
    });
    render(
      <App
        api={stubApi({ poll: graph([first, middle, ads]) })}
        pollId="ads-free"
      />,
    );

    await screen.findByText(first.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", { name: /How do we pay for it\?/ }),
    );
    await screen.findByText(middle.question);
    // A choice that opens another question carries its preview in the
    // accessible name, so this matches loosely on purpose.
    fireEvent.click(screen.getByRole("button", { name: /Members chip in/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Which ads are allowed\?/ }),
    );
    await screen.findByText(ads.question);

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    // The middle question, not the one the run started on.
    expect((await screen.findByRole("heading")).textContent).toBe(
      middle.question,
    );
  });
});

describe("walking the run", () => {
  it("opens the question the answer named", async () => {
    const first = poll({
      id: "ads-free",
      choices: ["No", "Yes"],
      next: ["ads-allowed", "pay-for-it"],
    });
    const paid = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: ["Members chip in", "Donations", "Grants"],
      next: [null, null, null],
    });
    const ads = poll({
      id: "ads-allowed",
      question: "Which ads are allowed?",
      choices: [
        "All of them",
        "Only ones members vote through",
        "Research only",
      ],
      next: [null, null, null],
    });

    render(
      <App
        api={stubApi({ poll: graph([first, paid, ads]) })}
        pollId="ads-free"
      />,
    );
    await screen.findByText(first.question);

    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", { name: /How do we pay for it\?/ }),
    );

    expect(await screen.findByText("How do we pay for it?")).toBeTruthy();
    expect(screen.queryByText(first.question)).toBeNull();
  });

  it("takes the other path when the other answer is given", async () => {
    const first = poll({ next: ["ads-allowed", "pay-for-it"] });
    const paid = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: ["A", "B", "C"],
      next: [null, null, null],
    });
    const ads = poll({
      id: "ads-allowed",
      question: "Which ads are allowed?",
      choices: ["A", "B", "C"],
      next: [null, null, null],
    });

    render(
      <App
        api={stubApi({ poll: graph([first, paid, ads]) })}
        pollId="ads-free"
      />,
    );
    await screen.findByText(first.question);

    fireEvent.keyDown(screen.getByText("No"), { key: "ArrowLeft" });
    fireEvent.click(
      await screen.findByRole("button", { name: /Which ads are allowed\?/ }),
    );

    expect(await screen.findByText("Which ads are allowed?")).toBeTruthy();
  });

  it("does not carry the answer to one question onto the next", async () => {
    const first = poll({ next: [null, "pay-for-it"] });
    const paid = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: ["A", "B", "C"],
      next: [null, null, null],
    });

    render(
      <App api={stubApi({ poll: graph([first, paid]) })} pollId="ads-free" />,
    );
    await screen.findByText(first.question);

    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", { name: /How do we pay for it\?/ }),
    );

    await screen.findByText("How do we pay for it?");
    // The second question is being asked, not answered: no outcome is showing.
    expect(screen.queryByText("Counted.")).toBeNull();
    expect(screen.getByRole("button", { name: "A" })).toBeTruthy();
  });
});
