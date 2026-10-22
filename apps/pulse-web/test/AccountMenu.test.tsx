// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../src/components/AccountMenu.js";
import { TwoPress } from "../src/components/TwoPress.js";
import type { TwoPressProgress } from "../src/components/TwoPress.js";

afterEach(cleanup);

/** Hidden (the panel, or anything in it) rather than drawn. */
const hidden = (node: Element) => node.closest("[hidden]") !== null;

function show() {
  render(
    <>
      <AccountMenu>
        <span>you@example.org</span>
        <button type="button">Sign out</button>
      </AccountMenu>
      <button type="button">Elsewhere</button>
      <p>Page</p>
    </>,
  );
  return screen.getByRole("button", { name: "Account" });
}

describe("the account button", () => {
  it("starts closed and says so", () => {
    const button = show();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(hidden(screen.getByText("you@example.org"))).toBe(true);
  });

  it("opens and closes by keyboard, and names what it controls", async () => {
    const user = userEvent.setup();
    const button = show();
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      button.getAttribute("aria-controls") ?? "",
    );
    expect(panel?.textContent).toContain("you@example.org");
    expect(hidden(screen.getByText("you@example.org"))).toBe(false);
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape from inside and puts focus back on the button", async () => {
    const user = userEvent.setup();
    const button = show();
    await user.click(button);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sign out" }),
    );
    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes when someone presses outside it", async () => {
    const user = userEvent.setup();
    const button = show();
    await user.click(button);
    await user.click(screen.getByText("you@example.org"));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByText("Page"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when focus moves on past it", async () => {
    const user = userEvent.setup();
    const button = show();
    await user.click(button);
    await user.tab(); // to Sign out, inside
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await user.tab(); // to Elsewhere, outside
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Elsewhere" }),
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

/*
 * Closed mid-request: the sign-out still answers, and a failure must be there
 * to read when the panel is opened again (review of #420).
 */
describe("a request that fails after the panel closed", () => {
  let setProgress: (progress: TwoPressProgress) => void = () => {};
  function Harness() {
    const [progress, set] = useState<TwoPressProgress>({ status: "idle" });
    setProgress = set;
    return (
      <AccountMenu>
        <TwoPress
          label="Sign out"
          question="Sign out on every device?"
          confirmLabel="Sign out everywhere"
          pendingLabel="Signing out…"
          progress={progress}
          onConfirm={() => set({ status: "sending" })}
          onCancel={() => set({ status: "idle" })}
        />
      </AccountMenu>
    );
  }

  it("shows the error on reopening", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Account" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );
    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() =>
      setProgress({ status: "failed", message: "You are still signed in." }),
    );
    await user.click(button);
    expect(screen.getByRole("alert").textContent).toBe(
      "You are still signed in.",
    );
  });
});
