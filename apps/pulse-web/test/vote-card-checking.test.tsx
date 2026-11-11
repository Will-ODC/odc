// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoteCard } from "../src/components/VoteCard.js";
import type { VoteCardProps } from "../src/components/VoteCard.js";

/*
 * After a failed send the caller asks the server which answer it holds
 * (#527). While it asks, the card keeps Close where it is, says so, and
 * holds Try again; both widths draw their Close from the same rule.
 */
afterEach(cleanup);
const base: VoteCardProps = {
  question: "What should we build?",
  method: "single",
  choices: [
    { index: 0, label: "Park" },
    { index: 1, label: "Library" },
  ],
  picked: [1],
  status: { kind: "failed", message: "Couldn't reach pulse." },
  privacyNote: "Your answer is private.",
  collapsed: false,
  onPick: vi.fn(),
  onSubmit: vi.fn(),
  onCollapse: vi.fn(),
  onClose: vi.fn(),
};
const close = () => screen.getByRole("button", { name: "Close" });

describe.each([
  { layout: "phone sheet", inPage: false },
  { layout: "desktop page", inPage: true },
])("in the $layout", ({ inPage }) => {
  it("keeps Close focusable but inert, says it is checking, and holds Try again", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <VoteCard
        {...base}
        inPage={inPage}
        closable
        checking
        onClose={onClose}
      />,
    );
    expect(close().getAttribute("aria-disabled")).toBe("true");
    expect(close().hasAttribute("disabled")).toBe(false);
    await user.click(close());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(close());
    expect(screen.getByText("Checking your answer…").getAttribute("role")).toBe(
      "status",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Try again" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("is an ordinary Close and problem once the check is over", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<VoteCard {...base} inPage={inPage} closable onClose={onClose} />);
    expect(close().getAttribute("aria-disabled")).toBeNull();
    await user.click(close());
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't reach pulse.");
    expect(screen.queryByText("Checking your answer…")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Try again" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
