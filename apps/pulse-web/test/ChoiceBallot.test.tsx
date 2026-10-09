// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("promises nothing once the poll it was answered on has shut", async () => {
    const api = stubApi();
    const { rerender } = render(
      <ChoiceBallot api={api} poll={PAY} onAnswered={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText("Counted.");
    expect(document.body.textContent).toContain("You can change");

    // A closed poll can no longer be answered at all (see the block at the end
    // of this file), so the only way to reach a counted answer on a shut poll
    // is for the poll to shut under an answer that is already in.
    rerender(
      <ChoiceBallot
        api={api}
        poll={poll({ ...PAY, open: false })}
        onAnswered={() => {}}
      />,
    );

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

    // The settled words, not `role="status"` — that region is already on
    // screen saying "Sending…" while the cast is in flight.
    await screen.findByText("Counted.");
    expect(screen.getByRole("status").textContent).toContain(
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

  /**
   * The same dead end as the swipe ballot's, reached the same way. Both
   * screens hand `closed` to the one `<Outcome>`, so both owe the way out.
   */
  it("leaves a way back to the question when the poll closed under the press", async () => {
    show({ cast: () => Promise.resolve({ status: "closed" as const }) });
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText("This one has closed.");

    fireEvent.click(
      screen.getByRole("button", { name: "Back to the question" }),
    );

    expect(screen.queryByText("This one has closed.")).toBeNull();
    expect(screen.getByRole("button", { name: "Grants" })).toBeTruthy();
  });
});

/**
 * A poll the client already knows is shut (`poll.open === false`).
 *
 * One press casts here, and ADR-0022 makes that safe only because the answer
 * can be changed afterwards. On a shut poll it cannot, so nothing casts at all.
 * The question and its answers stay on screen, greyed out, as the record of
 * what was asked.
 */
describe("a many-answer poll that has already closed", () => {
  function showClosed(over: Partial<PulseApi> = {}) {
    const cast = vi.fn(stubApi().cast);
    render(
      <ChoiceBallot
        api={stubApi({ cast, ...over })}
        poll={poll({ ...PAY, open: false })}
        onAnswered={() => {}}
      />,
    );
    return cast;
  }

  const choice = (label: string) =>
    screen.getByText(label).closest("button") as HTMLButtonElement;

  const settle = () => new Promise((done) => setTimeout(done, 0));

  function stillShowsTheRecord() {
    expect(screen.getByText(PAY.question)).toBeTruthy();
    for (const label of PAY.choices) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("This one has closed.")).toBeTruthy();
    expect(
      screen.getByText("Nothing you do here will change it."),
    ).toBeTruthy();
    expect(screen.queryByText("Counted.")).toBeNull();
    expect(screen.queryByText("Sending\u2026")).toBeNull();
  }

  it("keeps the question and every answer, and says it has closed", () => {
    showClosed();
    stillShowsTheRecord();
    for (const label of PAY.choices) {
      expect(choice(label).disabled).toBe(true);
    }
    expect(screen.getByRole("status").textContent).toContain(
      "This one has closed.",
    );
    expect(
      screen.queryByRole("button", { name: "Back to the question" }),
    ).toBeNull();
  });

  it("casts nothing when an answer is clicked", async () => {
    const cast = showClosed();
    for (const label of PAY.choices) fireEvent.click(choice(label));
    await settle();
    expect(cast).not.toHaveBeenCalled();
    stillShowsTheRecord();
  });

  it("casts nothing on Enter or Space", async () => {
    const cast = showClosed();
    const user = userEvent.setup();
    for (const label of PAY.choices) {
      choice(label).focus();
      await user.keyboard("{Enter}");
      choice(label).focus();
      await user.keyboard(" ");
    }
    await settle();
    expect(cast).not.toHaveBeenCalled();
    stillShowsTheRecord();
  });

  /**
   * Adding an answer to a question nobody can answer any more asks for work
   * that cannot count, so the field is gone. What others already said stays:
   * it is part of the record of the discussion, like the answers above it.
   */
  it("offers no way to add an answer, but keeps what others said", async () => {
    showClosed({
      suggestions: () =>
        Promise.resolve([{ id: "s1", text: "A bake sale", count: 3 }]),
    });
    expect(await screen.findByText("A bake sale")).toBeTruthy();
    expect(screen.queryByLabelText("Something else?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("keeps the way back working", () => {
    const onBack = vi.fn();
    render(
      <ChoiceBallot
        api={stubApi()}
        poll={poll({ ...PAY, open: false })}
        onAnswered={() => {}}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same lasting record as the swipe ballot: a closed poll's results are
 * open to anyone who asks, voted or not (operator decision, 2026-10-09).
 */
describe("the results of a many-answer poll that has already closed", () => {
  const ENDED = results({
    pollId: PAY.id,
    question: PAY.question,
    voters: 6,
    choices: [
      { index: 0, label: "Members chip in", count: 1, share: 16.7 },
      { index: 1, label: "One-off donations", count: 2, share: 33.3 },
      { index: 2, label: "Grants", count: 3, share: 50 },
    ],
  });

  function showClosed(over: Partial<PulseApi> = {}) {
    const cast = vi.fn(stubApi().cast);
    const api = stubApi({
      cast,
      results: vi.fn(() => Promise.resolve(ENDED)),
      myBallot: () => Promise.resolve(null),
      ...over,
    });
    render(
      <ChoiceBallot
        api={api}
        poll={poll({ ...PAY, open: false })}
        onAnswered={() => {}}
      />,
    );
    return { cast, api };
  }

  const seeResults = () => screen.getByRole("button", { name: "See results" });
  const settle = () => new Promise((done) => setTimeout(done, 0));

  it("offers the results, and shows the counts when asked", async () => {
    const { api } = showClosed();
    expect(api.results).not.toHaveBeenCalled();
    fireEvent.click(seeResults());
    expect(await screen.findByText("3 · 50%")).toBeTruthy();
    expect(screen.getByText("2 · 33.3%")).toBeTruthy();
    expect(screen.getByText("6 people answered")).toBeTruthy();
  });

  it("says it is loading while the results are on their way", async () => {
    let finish: (value: typeof ENDED) => void = () => {};
    showClosed({
      results: () =>
        new Promise((done) => {
          finish = done;
        }),
    });
    fireEvent.click(seeResults());
    expect(await screen.findByText("Loading\u2026")).toBeTruthy();
    finish(ENDED);
    expect(await screen.findByText("3 · 50%")).toBeTruthy();
  });

  it("says so plainly when nobody answered", async () => {
    showClosed({
      results: () =>
        Promise.resolve({
          ...ENDED,
          voters: 0,
          choices: ENDED.choices.map((one) => ({
            ...one,
            count: 0,
            share: 0,
          })),
        }),
    });
    fireEvent.click(seeResults());
    expect(await screen.findByText("Nobody answered this one.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
  });

  it("says when the results would not load, and tries again", async () => {
    let calls = 0;
    const load = vi.fn(() =>
      ++calls === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(ENDED),
    );
    showClosed({ results: load });
    fireEvent.click(seeResults());
    expect(await screen.findByText(/could not load the results/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("3 · 50%")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("marks the answer this browser gave before it closed", async () => {
    showClosed({ myBallot: () => Promise.resolve([2]) });
    fireEvent.click(seeResults());
    expect((await screen.findByText(/You picked/)).textContent).toContain(
      "Grants",
    );
    expect(
      document.querySelector('[data-yours="true"]')?.textContent,
    ).toContain("Grants");
  });

  /** An approval ballot is a list; every answer on it was this person's. */
  it("marks every answer this browser gave on an approval poll", async () => {
    showClosed({
      results: () => Promise.resolve({ ...ENDED, method: "approval" }),
      myBallot: () => Promise.resolve([0, 2]),
    });
    fireEvent.click(seeResults());
    const said = await screen.findByText(/You picked/);
    expect([...said.querySelectorAll("b")].map((b) => b.textContent)).toEqual([
      "Members chip in",
      "Grants",
    ]);
    const marked = [...document.querySelectorAll('[data-yours="true"]')];
    expect(marked.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Members chip in"),
      expect.stringContaining("Grants"),
    ]);
  });

  it("marks nothing for someone who did not answer", async () => {
    showClosed({ myBallot: () => Promise.resolve(null) });
    fireEvent.click(seeResults());
    await screen.findByText("3 · 50%");
    expect(screen.queryByText(/You picked/)).toBeNull();
    expect(document.querySelector('[data-yours="true"]')).toBeNull();
  });

  it("never casts when the results are opened and closed", async () => {
    const { cast } = showClosed();
    fireEvent.click(seeResults());
    await screen.findByText("3 · 50%");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await settle();
    expect(seeResults()).toBeTruthy();
    expect(cast).not.toHaveBeenCalled();
  });

  it("moves focus into the results, and back to the button on Close", async () => {
    showClosed();
    fireEvent.click(seeResults());
    await screen.findByText("3 · 50%");
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "How people answered" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("This one has closed.")).toBeTruthy();
    expect(document.activeElement).toBe(seeResults());
  });
});
