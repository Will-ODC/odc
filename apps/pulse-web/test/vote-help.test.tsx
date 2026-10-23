// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, results, stubApi } from "./stub-api.js";
afterEach(cleanup);

it("votes, reopens the drawer and changes an answer without tutorial controls", async () => {
  const cast = vi
    .fn()
    .mockResolvedValue({ status: "counted", ballot: [1], results: results() });
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await screen.findByRole("heading", { name: poll().question, level: 1 });
  expect(screen.queryByRole("button", { name: "Show me how" })).toBeNull();
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  expect(screen.getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(cast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText("Counted");
  expect(screen.queryByRole("button", { name: "Show me how" })).toBeNull();
  // The results and the drawer handle both offer it; use the drawer's.
  await user.click(
    within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
      "button",
      { name: "Change my answer" },
    ),
  );
  expect(screen.getByRole("radio", { name: "Yes" })).toBeTruthy();
  expect(cast).toHaveBeenCalledExactlyOnceWith("ads-free", [1]);
  expect(screen.queryByLabelText("Voting help")).toBeNull();
});
