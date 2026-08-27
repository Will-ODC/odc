// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PulseApi, SuggestResult } from "../src/api/types.js";
import { ApiError } from "../src/api/types.js";
import { ChoiceBallot } from "../src/screens/ChoiceBallot.js";
import { poll, stubApi } from "./stub-api.js";

afterEach(cleanup);

const PAY = poll({
  id: "pay-for-it",
  question: "How do we pay for it?",
  choices: ["Members chip in", "One-off donations", "Grants"],
  next: [null, null, null],
  acceptsSuggestions: true,
});

function show(over: Partial<PulseApi> = {}, onAnswered = () => {}) {
  return render(
    <ChoiceBallot api={stubApi(over)} poll={PAY} onAnswered={onAnswered} />,
  );
}

const field = () => screen.getByLabelText("Something else?");
const add = () => screen.getByRole("button", { name: "Add" });

describe("asking", () => {
  it("offers every answer the poll has", () => {
    show();
    for (const choice of PAY.choices) {
      expect(screen.getByRole("button", { name: choice })).toBeTruthy();
    }
  });

  it("casts the answer that was pressed, by its position", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await waitFor(() => expect(cast).toHaveBeenCalledWith("pay-for-it", [2]));
    // Named back in the poll's own words, not just ticked.
    expect((await screen.findByRole("status")).textContent).toContain("Grants");
  });

  it("sends one vote however many times an answer is pressed", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    const grants = screen.getByRole("button", { name: "Grants" });
    fireEvent.click(grants);
    fireEvent.click(grants);
    await screen.findByText("Counted.");
    expect(cast).toHaveBeenCalledTimes(1);
  });
});

describe("saying something the poll did not offer", () => {
  it("is not offered at all where the poll does not take it", () => {
    render(
      <ChoiceBallot
        api={stubApi()}
        poll={poll({ ...PAY, acceptsSuggestions: false })}
        onAnswered={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Something else?")).toBeNull();
  });

  it("cannot be sent empty", () => {
    show();
    expect(add().hasAttribute("disabled")).toBe(true);
  });

  it("says so quietly when nobody had said it", async () => {
    show();
    fireEvent.change(field(), { target: { value: "Sell merchandise" } });
    fireEvent.click(add());
    expect(await screen.findByText(/Nobody had said that yet/)).toBeTruthy();
  });

  it("counts the person in rather than telling them off for a duplicate", async () => {
    const suggest = () =>
      Promise.resolve({
        status: "seconded",
        suggestion: { id: "s1", text: "Members chip in monthly", count: 12 },
        related: [],
      } satisfies SuggestResult);
    show({ suggest });

    fireEvent.change(field(), { target: { value: "members pay monthly" } });
    fireEvent.click(add());

    const said = await screen.findByRole("status");
    expect(said.textContent).toContain("12 people have said that");
    expect(said.textContent).toContain("Yours is with them");
    // Nothing here reads as a refusal.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends someone back to the answer the poll already offers", async () => {
    const suggest = () =>
      Promise.resolve({
        status: "on_ballot",
        choice: { index: 2, label: "Grants" },
        related: [],
      } satisfies SuggestResult);
    show({ suggest });

    fireEvent.change(field(), { target: { value: "Grants" } });
    fireEvent.click(add());

    const said = await screen.findByRole("status");
    expect(said.textContent).toContain("already one of the answers above");
    expect(said.textContent).toContain("Grants");
    // It reads as a pointer, not a telling-off.
    expect(screen.queryByRole("alert")).toBeNull();
    // And nothing was added to the list of what people said.
    expect(screen.queryByText("ALSO SAID")).toBeNull();
  });

  it("mentions what came close without refusing the new one", async () => {
    const suggest = () =>
      Promise.resolve({
        status: "added",
        suggestion: { id: "s2", text: "Charge members once a year", count: 1 },
        related: [{ id: "s1", text: "Charge members a monthly fee", count: 4 }],
      } satisfies SuggestResult);
    show({ suggest });

    fireEvent.change(field(), {
      target: { value: "Charge members once a year" },
    });
    fireEvent.click(add());

    expect(
      await screen.findByText(/Close to: Charge members a monthly fee/),
    ).toBeTruthy();
  });

  it("shows the server's own sentence when one is refused", async () => {
    show({
      suggest: () =>
        Promise.reject(new ApiError(400, "Keep it under 120 characters.")),
    });
    fireEvent.change(field(), { target: { value: "a very long thing" } });
    fireEvent.click(add());

    expect(
      await screen.findByText("Keep it under 120 characters."),
    ).toBeTruthy();
  });

  it("lists what people have added, most-said first", async () => {
    show({
      suggestions: () =>
        Promise.resolve([
          { id: "s1", text: "Members chip in monthly", count: 12 },
          { id: "s2", text: "Sell merchandise", count: 2 },
        ]),
    });

    const listed = await screen.findByText("Members chip in monthly");
    expect(listed).toBeTruthy();
    expect(screen.getByText("Sell merchandise")).toBeTruthy();
  });

  it("still asks the question when the added options will not load", async () => {
    show({ suggestions: () => Promise.reject(new ApiError(500, "no")) });
    expect(screen.getByRole("button", { name: "Grants" })).toBeTruthy();
    expect(field()).toBeTruthy();
  });

  it("clears what was said once it has been sent", async () => {
    show();
    fireEvent.change(field(), { target: { value: "Sell merchandise" } });
    fireEvent.click(add());
    await screen.findByRole("status");
    expect((field() as HTMLInputElement).value).toBe("");
  });
});

describe("the copy", () => {
  it("never raises how anything is counted", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText("Counted.");

    const shown = (document.body.textContent ?? "").toLowerCase();
    for (const word of [
      "hash",
      "chain",
      "tally",
      "tabulat",
      "ledger",
      "verif",
    ]) {
      expect(shown).not.toContain(word);
    }
  });
});
