// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Ballot, CastOutcome, Poll } from "../src/api/types.js";
import { WIDE } from "../src/hooks/use-wide.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, results, stubApi } from "./stub-api.js";

/*
 * The desktop layout (#490): at 700px and wider, voting sits in the page
 * under the question instead of in the bottom-right drawer. jsdom has no
 * `matchMedia`, so every other suite draws the phone layout; this one says
 * the window is wide.
 */
beforeAll(async () => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === WIDE,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  await import("../src/components/BarChart.js");
});
afterAll(() => {
  Reflect.deleteProperty(window, "matchMedia");
});
afterEach(cleanup);

const main = () => within(screen.getByRole("main"));
const said = (text: string) => (_: string, node: Element | null) =>
  node?.tagName === "SPAN" && node.textContent === text;
function tally(p: Poll, ballot: Ballot) {
  return results({
    pollId: p.id,
    question: p.question,
    method: p.method,
    voters: 1,
    choices: p.choices.map((label, index) => ({
      index,
      label,
      count: ballot.includes(index) ? 1 : 0,
      share: ballot.includes(index) ? 100 : 0,
    })),
  });
}
function counting(p: Poll) {
  let attempt = 0;
  return vi.fn(async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
    status: attempt++ === 0 ? "counted" : "changed",
    ballot,
    results: tally(p, ballot),
  }));
}

it("puts the choices in the page under the question, with no drawer", async () => {
  const p = poll();
  render(<Conversation api={stubApi()} pollId={p.id} />);
  const heading = await main().findByRole("heading", {
    name: p.question,
    level: 1,
  });
  expect(screen.queryByRole("complementary", { name: "Voting" })).toBeNull();
  const voting = main().getByRole("region", { name: p.question });
  expect(
    heading.compareDocumentPosition(voting) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The question prints once: no label, no second heading, nothing to close.
  expect(within(voting).queryByText("DECISION")).toBeNull();
  expect(within(voting).queryByRole("heading")).toBeNull();
  expect(within(voting).queryByRole("button", { name: "Close" })).toBeNull();
  expect(within(voting).getByRole("group", { name: p.question })).toBeTruthy();
  expect(within(voting).getByText("Your answer is private.")).toBeTruthy();
});

it("folds the answer into the You picked line, which takes focus and holds Change my answer", async () => {
  const p = poll();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast: counting(p) })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  const line = (await main().findByText(said("You picked Yes.")))
    .parentElement!;
  await waitFor(() => expect(document.activeElement).toBe(line));
  expect(main().queryByRole("radio")).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Change my answer" }),
  ).toHaveLength(1);
  expect(
    within(line).getByRole("button", { name: "Change my answer" }),
  ).toBeTruthy();
  expect(
    main().getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
});

it("changes an answer in place, keeps the results, and Close sends nothing", async () => {
  const p = poll();
  const cast = counting(p);
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText(said("You picked Yes."));

  await user.click(main().getByRole("button", { name: "Change my answer" }));
  const yes = main().getByRole("radio", { name: "Yes" });
  expect(yes).toHaveProperty("checked", true);
  expect(document.activeElement).toBe(yes);
  // The saved answer's results stay on the page while choosing again.
  expect(
    main().getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change my answer" })).toBeNull();

  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Close" }));
  expect(cast).toHaveBeenCalledTimes(1);
  expect(main().getByText(said("You picked Yes."))).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      main().getByRole("button", { name: "Change my answer" }),
    ),
  );

  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(main().getByText(said("You picked No."))).toBeTruthy();
});

it("keeps a closed question's choices on the page with See results under them", async () => {
  const p = poll({ open: false });
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(screen.queryByRole("complementary", { name: "Voting" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show question" })).toBeNull();
  expect(main().getByRole("group", { name: p.question })).toHaveProperty(
    "disabled",
    true,
  );
  expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
  expect(main().getByRole("button", { name: "See results" })).toBeTruthy();
});
