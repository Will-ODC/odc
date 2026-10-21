// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../src/components/AccountMenu.js";

afterEach(cleanup);

function show() {
  render(
    <AccountMenu>
      <span>you@example.org</span>
      <button type="button">Sign out</button>
    </AccountMenu>,
  );
  return screen.getByRole("button", { name: "Account" });
}

describe("the account button", () => {
  it("starts closed and says so", () => {
    const button = show();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("you@example.org")).toBeNull();
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
});
