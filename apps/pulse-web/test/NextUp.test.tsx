// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NextUp } from "../src/components/NextUp.js";

afterEach(cleanup);

describe("where each answer leads", () => {
  it("names the question each answer opens", () => {
    render(
      <NextUp
        items={[
          { answer: "No", question: "Which ads are allowed?" },
          { answer: "Yes", question: "How do we pay for it?" },
        ]}
      />,
    );
    expect(screen.getByText("Which ads are allowed?")).toBeTruthy();
    expect(screen.getByText("How do we pay for it?")).toBeTruthy();
  });

  /*
   * The empty state says what it means. A rail that simply vanished on the
   * last question would read as a rail that failed to load.
   */
  it("says so when the answer ends the run", () => {
    render(<NextUp items={[]} />);
    expect(screen.getByText(/Nothing follows this one yet/)).toBeTruthy();
  });

  /*
   * A preview that did not arrive is not an error and does not remove the
   * row: the edge is a fact about the poll, and only its wording is missing.
   * `useNextQuestions` already decided that failing to show what comes next
   * is no reason to interrupt the vote.
   */
  it("keeps the row when the wording did not arrive", () => {
    render(<NextUp items={[{ answer: "Yes" }]} />);
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("The next question")).toBeTruthy();
  });

  /* Two answers may legitimately read the same; neither may be dropped. */
  it("lists both of two answers that read alike", () => {
    render(
      <NextUp
        items={[
          { answer: "Yes", question: "Which ads are allowed?" },
          { answer: "Yes", question: "How do we pay for it?" },
        ]}
      />,
    );
    expect(screen.getAllByText("Yes").length).toBe(2);
  });
});
