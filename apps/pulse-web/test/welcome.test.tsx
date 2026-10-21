// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ApiError } from "../src/api/types.js";
import { poll, stubApi } from "./stub-api.js";

afterEach(cleanup);
beforeEach(() => history.replaceState(null, "", "/"));
async function begin() {
  await userEvent.click(screen.getByRole("button", { name: "Start voting" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Help choose what comes next" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "How should the voting page look?" }),
  );
}

it("explains three steps without contacting the API or showing unfinished media", () => {
  const read = vi.fn();
  const cast = vi.fn();
  render(<App api={stubApi({ poll: read, cast })} firstPollId="website-ui" />);
  expect(
    screen.getByRole("heading", {
      name: "Help shape an Online Democratic Community",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("list").children).toHaveLength(3);
  expect(screen.getByText("Understand")).toBeTruthy();
  expect(screen.getByText("Discuss")).toBeTruthy();
  expect(screen.getByText("Vote", { selector: "strong" })).toBeTruthy();
  expect(screen.getByText(/Comments are coming soon/)).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
  expect(cast).not.toHaveBeenCalled();
  expect(document.querySelector("video, iframe")).toBeNull();
});

it("starts the configured vote by keyboard without picking or casting, and keeps a welcome history entry", async () => {
  const user = userEvent.setup();
  const read = vi.fn(async () =>
    poll({ id: "website-ui", question: "Which website layout?" }),
  );
  const cast = vi.fn();
  render(<App api={stubApi({ poll: read, cast })} firstPollId="website-ui" />);
  const before = history.length;
  const start = screen.getByRole("button", { name: "Start voting" });
  start.focus();
  await user.keyboard("{Enter}");
  expect(read).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Help choose what comes next" }),
  );
  await user.click(
    screen.getByRole("button", { name: "How should the voting page look?" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Which website layout?",
      level: 1,
    }),
  ).toBeTruthy();
  expect(read).toHaveBeenCalledWith("website-ui");
  expect(location.search).toBe("?poll=website-ui");
  expect(history.length).toBe(before + 3);
  expect(document.querySelectorAll("input:checked")).toHaveLength(0);
  expect(cast).not.toHaveBeenCalled();
});

it("keeps direct poll URLs separate from the welcome configuration", async () => {
  history.replaceState(null, "", "/?poll=shared-poll");
  const read = vi.fn(async () => poll({ id: "shared-poll" }));
  render(<App api={stubApi({ poll: read })} firstPollId="website-ui" />);
  await screen.findByRole("region");
  expect(read).toHaveBeenCalledWith("shared-poll");
  expect(screen.queryByRole("button", { name: "Start voting" })).toBeNull();
});

it("reports an unavailable configured poll and allows a retry without inventing another", async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(404, "That question is not available."))
    .mockResolvedValue(poll({ id: "website-ui" }));
  render(<App api={stubApi({ poll: read })} firstPollId="website-ui" />);
  await begin();
  expect(
    await screen.findByText("There is nothing to vote on yet."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("region");
  expect(read.mock.calls.every(([id]) => id === "website-ui")).toBe(true);
});

it("keeps a closed configured poll readable without casting", async () => {
  const cast = vi.fn();
  render(
    <App
      api={stubApi({ poll: async () => poll({ open: false }), cast })}
      firstPollId="website-ui"
    />,
  );
  await begin();
  await screen.findByText("This one has closed.");
  expect(screen.getByText("This one has closed.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  expect(screen.getByRole("button", { name: "See results" })).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
});
