// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, results, stubApi } from "./stub-api.js";
afterEach(cleanup);

it("guides real controls, skips with Escape, and replays without casting", async () => {
  const cast = vi.fn();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  const help = await screen.findByRole("button", { name: "Show me how" });
  await user.click(help);
  const opening = screen.getByText("Open the vote card.");
  const vote = screen.getByRole("button", { name: "Vote" });
  expect(vote.getAttribute("aria-describedby")).toContain(opening.id);
  expect(document.activeElement).toBe(vote);
  await user.keyboard("{Escape}");
  expect(screen.queryByText("Open the vote card.")).toBeNull();
  expect(document.activeElement).toBe(help);
  expect(vote.hasAttribute("aria-describedby")).toBe(false);
  await user.click(help);
  await user.click(screen.getByRole("button", { name: "Vote" }));
  expect(
    screen.getByText("Choose your answer. Nothing is sent yet."),
  ).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  expect(screen.getByText("Press Submit to save your answer.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Skip help" }));
  expect(cast).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("radio", { name: "Yes" }) as HTMLInputElement).checked,
  ).toBe(true);
});

it("waits for normal successful Submit, and explains only available actions", async () => {
  const cast = vi
    .fn()
    .mockResolvedValue({ status: "counted", ballot: [1], results: results() });
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await user.click(await screen.findByRole("button", { name: "Show me how" }));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText(/Your answer is saved. Read results/);
  expect(cast).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Next opens/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Done with help" }));
  expect(
    screen.getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
});

it("keeps retry guidance honest and does not cast through help", async () => {
  const cast = vi.fn().mockRejectedValue(new Error("offline"));
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await user.click(await screen.findByRole("button", { name: "Show me how" }));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText(
    "Your answer was not saved. Press Try again to retry.",
  );
  expect(cast).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Skip help" }));
  expect(cast).toHaveBeenCalledTimes(1);
});

it("offers no guide on loading or closed questions", async () => {
  const { unmount } = render(
    <Conversation
      api={stubApi({ poll: () => new Promise(() => {}) })}
      pollId="ads-free"
    />,
  );
  expect(screen.queryByRole("button", { name: "Show me how" })).toBeNull();
  unmount();
  render(
    <Conversation
      api={stubApi({ poll: async () => poll({ open: false }) })}
      pollId="ads-free"
    />,
  );
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("button", { name: "Show me how" })).toBeNull();
  expect(
    within(screen.getByRole("main")).getByRole("button", { name: "Vote" }),
  ).toBeTruthy();
});

it("does not duplicate an in-flight vote and handles closure without success guidance", async () => {
  let finish!: (value: { status: "closed" }) => void;
  const cast = vi.fn(
    () =>
      new Promise<{ status: "closed" }>((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await user.click(await screen.findByRole("button", { name: "Show me how" }));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  expect(
    screen.getByText("Your answer is being sent. Please wait."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Sending…" }));
  expect(cast).toHaveBeenCalledTimes(1);
  finish({ status: "closed" });
  await screen.findByText("Voting has closed. You can read the results.");
  expect(screen.queryByText(/Your answer is saved/)).toBeNull();
});

it("does not offer help for a missing question and removes guidance on Next", async () => {
  const missing = render(
    <Conversation
      api={stubApi({
        poll: async () => {
          throw new ApiError(404, "Missing");
        },
      })}
      pollId="missing"
    />,
  );
  await screen.findByText("There is nothing to vote on yet.");
  expect(screen.queryByRole("button", { name: "Show me how" })).toBeNull();
  missing.unmount();
  const user = userEvent.setup();
  const cast = vi
    .fn()
    .mockResolvedValue({ status: "counted", ballot: [1], results: results() });
  render(
    <Conversation
      api={stubApi({
        poll: async (id) =>
          poll({ id, next: [null, "following"], question: id }),
        cast,
      })}
      pollId="first"
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Show me how" }));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText(/Next opens a linked question/);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "following", level: 1 });
  expect(screen.queryByLabelText("Voting help")).toBeNull();
  expect(cast).toHaveBeenCalledTimes(1);
});
