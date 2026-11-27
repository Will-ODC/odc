// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, stubApi } from "./stub-api.js";
import { main, card, answer, castYes } from "./conversation-fixtures.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

it("shows the just-posted line only when told the question was just posted", async () => {
  const onDismiss = vi.fn();
  const { unmount } = render(
    <Conversation
      api={stubApi()}
      pollId="ads-free"
      posted={{ url: "https://pulse.test/?poll=ads-free", onDismiss }}
    />,
  );
  expect(await screen.findByText(/Your question is live/)).toBeTruthy();
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  // Focus goes to the question the line sat over, not to the page.
  expect(document.activeElement).toBe(
    main().getByRole("heading", { name: poll().question, level: 1 }),
  );
  unmount();
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  expect(screen.queryByText(/Your question is live/)).toBeNull();
});

it("offers one Copy link under the question, and none while the posted line shows it", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  try {
    const { unmount } = render(
      <Conversation api={stubApi()} pollId="ads-free" />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(main().getAllByRole("button", { name: /Copy link/ })).toHaveLength(
      1,
    );
    await userEvent.click(
      main().getByRole("button", { name: `Copy link to ${poll().question}` }),
    );
    expect(writeText).toHaveBeenCalledWith(
      new URL("/?poll=ads-free", location.href).href,
    );
    expect(await main().findByText("Copied")).toBeTruthy();
    unmount();

    render(
      <Conversation
        api={stubApi()}
        pollId="ads-free"
        posted={{
          url: "https://pulse.test/?poll=ads-free",
          onDismiss: vi.fn(),
        }}
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(
      1,
    );
    expect(screen.getByText(/Your question is live/)).toBeTruthy();
  } finally {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  }
});

it("ends the just-posted line when Next moves to another question", async () => {
  const first = poll({ next: [null, "parks"] });
  const parks = poll({ id: "parks", question: "More parks?" });
  const onDismiss = vi.fn();
  render(
    <Conversation
      api={stubApi({ cast: castYes, poll: graph([first, parks]) })}
      pollId={first.id}
      posted={{ url: "https://pulse.test/?poll=ads-free", onDismiss }}
    />,
  );
  await main().findByRole("heading", { name: first.question, level: 1 });
  const user = await answer("Yes");
  await user.click(
    within(card()).getByRole("button", { name: "Next question" }),
  );
  await main().findByRole("heading", { name: "More parks?", level: 1 });
  expect(screen.queryByText(/Your question is live/)).toBeNull();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
