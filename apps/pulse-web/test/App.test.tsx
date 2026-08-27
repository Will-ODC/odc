// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
