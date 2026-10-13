// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { poll, stubApi } from "./stub-api.js";

afterEach(cleanup);
beforeEach(() => history.replaceState(null, "", "/"));

it("explains recent progress and purpose before offering independently accessible votes", async () => {
  const read = vi.fn(async (id: string) => poll({ id }));
  const cast = vi.fn();
  const user = userEvent.setup();
  render(
    <App
      api={stubApi({ poll: read, cast })}
      firstPollId="website-ui"
      relatedPollIds={{
        data: "data-use",
        funding: "funding",
        revote: "revote",
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Start voting" }));
  expect(
    await screen.findByRole("heading", {
      name: "What we’re building together",
    }),
  ).toBeTruthy();
  expect(screen.getByText(/6–12 October 2026/)).toBeTruthy();
  expect(screen.getByText(/Anonymity stays an option/)).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
  expect(cast).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Help choose what comes next" }),
  );
  expect(
    screen.getByRole("heading", { name: "What should we decide next?" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(4);
  await user.click(
    screen.getByRole("button", { name: "How should optional data be used?" }),
  );
  await screen.findByRole("button", { name: "Vote" });
  expect(read).toHaveBeenCalledWith("data-use");
  expect(read).not.toHaveBeenCalledWith("website-ui");
  expect(cast).not.toHaveBeenCalled();
});

it("keeps the introduction useful when polls are not yet published or configured", async () => {
  const read = vi.fn();
  const user = userEvent.setup();
  render(<App api={stubApi({ poll: read })} />);
  await user.click(screen.getByRole("button", { name: "Start voting" }));
  await user.click(
    screen.getByRole("button", { name: "Help choose what comes next" }),
  );
  expect(
    screen
      .getAllByRole("button")
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
  expect(screen.getByText(/Questions marked “Coming soon”/)).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});

it("supports direct progress/question-list entry and browser navigation without requests", async () => {
  const read = vi.fn();
  history.replaceState(null, "", "/start");
  render(<App api={stubApi({ poll: read })} />);
  expect(
    screen.getByRole("heading", { name: "What we’re building together" }),
  ).toBeTruthy();
  history.replaceState(null, "", "/questions");
  dispatchEvent(new PopStateEvent("popstate"));
  expect(
    await screen.findByRole("heading", { name: "What should we decide next?" }),
  ).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});
