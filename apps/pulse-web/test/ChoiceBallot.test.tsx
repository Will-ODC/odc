// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PulseApi, SuggestResult } from "../src/api/types.js";
import { ApiError } from "../src/api/types.js";
import { ChoiceBallot } from "../src/screens/ChoiceBallot.js";
import { counted, poll, results, stubApi } from "./stub-api.js";

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

  /**
   * `<Outcome>` returns early on a `closed` cast and never reads `changeable`,
   * so only a poll the client already knows is shut exercises the prop. Without
   * this, `changeable={true}` would leave the suite green - and ADR-0022
   * section 3 rests entirely on the prop being read from `poll.open`.
   */
  it("promises nothing on a poll it already knows is shut", async () => {
    render(
      <ChoiceBallot
        api={stubApi()}
        poll={poll({ ...PAY, open: false })}
        onAnswered={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText("Counted.");

    expect(document.body.textContent).not.toContain("You can change");
    expect(
      screen.queryByRole("button", { name: "Change my answer" }),
    ).toBeNull();
  });

  /**
   * One press is one vote here too, and the sentence saying the answer is not
   * final is what stands in for the confirming press this screen does not ask
   * for. It has to be true on both ballots, not only the swipe.
   */
  it("puts the choices back when the answer is changed", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain(
      "You can change your answer until this question closes.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Change my answer" }));

    const again = screen.getByRole("button", { name: "Grants" });
    expect(again).toBeTruthy();
    expect(screen.queryByText("Counted.")).toBeNull();
    // Focus lands on a choice, not on the body: the control that was pressed
    // to get back here is unmounted by the same render.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Members chip in" }),
      ),
    );
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

describe("seeing where a many-answer question stands", () => {
  const MANY = results({
    pollId: PAY.id,
    question: PAY.question,
    voters: 9,
    choices: PAY.choices.map((label, index) => ({
      index,
      label,
      count: index === 2 ? 5 : 2,
      share: index === 2 ? 56 : 22,
    })),
  });

  const vote = async () => {
    show({ cast: () => Promise.resolve(counted(2, MANY)) });
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText("Counted.");
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
  };

  /**
   * The reuse this PR claims is only proven on one of the two ballots unless
   * this exists - and this is the screen where the choice list has no fixed
   * length, so it is the one that can outgrow the box it is drawn in.
   */
  it("names every answer, not only the two a swipe ballot has", async () => {
    await vote();
    // Scoped to the list: the chosen answer is also named in "You picked X".
    const rows = within(screen.getByRole("group", { name: /how people/i }));
    for (const choice of PAY.choices) {
      expect(rows.getAllByText(choice).length).toBeGreaterThan(0);
    }
  });

  it("leaves the way out reachable, whatever the answer count", async () => {
    await vote();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("marks the answer this person gave", async () => {
    await vote();
    expect(screen.getByText("yours")).toBeTruthy();
  });

  it("puts the outcome back when the panel is closed", async () => {
    await vote();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "See results" })).toBeTruthy();
  });
});
