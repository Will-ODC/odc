// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedIn } from "../src/components/SignedIn.js";

afterEach(cleanup);

const idle = { status: "idle" } as const;

describe("who is signed in, and the way out", () => {
  it("shows the address and a way out", () => {
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("voter@example.org")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  /*
   * Two presses, because signing back in does not undo it: every session ends
   * and this browser loses its ballot. The first press only asks.
   */
  it("asks before signing out, and says what it costs", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={onSignOut}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText(/stop showing your answers/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("cancelling changes nothing and goes back to the way out", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={onSignOut}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText("voter@example.org")).toBeTruthy();
  });

  it("works from the keyboard alone, with focus following the question", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={onSignOut}
        onCancel={vi.fn()}
      />,
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sign out" }),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );
    await user.tab();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sign out" }),
    );
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed twice while the server is answering", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    rerender(
      <SignedIn
        email="voter@example.org"
        progress={{ status: "sending" }}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // aria-disabled, not disabled: focus must not fall off to the page.
    const confirm = screen.getByRole("button", { name: "Signing out…" });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
  });

  it("says plainly when signing out failed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    rerender(
      <SignedIn
        email="voter@example.org"
        progress={{ status: "failed", message: "You are still signed in." }}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "You are still signed in.",
    );
    expect(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    ).toBeTruthy();
  });

  /*
   * The sentence is the whole point of the second press, so it must reach a
   * screen reader, which lands on the button rather than reading the page.
   */
  it("tells a screen reader what signing out costs", async () => {
    const user = userEvent.setup();
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const confirm = screen.getByRole("button", { name: "Sign out everywhere" });
    const describedBy = confirm.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toMatch(
      /every device/,
    );
  });

  it("tells the parent when the question is put away", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <SignedIn
        email="voter@example.org"
        progress={idle}
        onSignOut={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
