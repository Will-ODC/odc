// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TopBanner } from "../src/components/TopBanner.js";

afterEach(cleanup);

describe("the bar across the top", () => {
  it("offers a way to sign in", () => {
    render(<TopBanner signInHref="/sign-in" />);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/sign-in");
  });

  /*
   * One account control (operator walkthrough, 2026-10-21): three controls
   * side by side wrapped the bar onto two lines on a 375px phone. The
   * account's controls replace "Sign in" with one button, and are hidden
   * behind it until it is pressed.
   */
  it("shows one account button instead of the way in, its controls behind it", async () => {
    const user = userEvent.setup();
    render(
      <TopBanner
        postHref="/new"
        signInHref="/sign-in"
        account={<button type="button">Sign out</button>}
      />,
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    // Everything after the mark: the post link and ONE account control.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("shortens 'Post a question' with a part a narrow phone hides", () => {
    render(<TopBanner postHref="/new" />);
    const link = screen.getByRole("link", { name: "Post a question" });
    expect(link.querySelector(".banner__post-more")?.textContent).toBe(
      " a question",
    );
  });

  it("links the mark home when given somewhere to go", () => {
    render(<TopBanner homeHref="/" />);
    expect(
      screen.getByRole("link", { name: "pulse" }).getAttribute("href"),
    ).toBe("/");
  });

  /*
   * On the sign-in screens themselves the link would only reload the page the
   * person is already on, so those screens leave it out.
   */
  it("offers no way in when it is given nowhere to send someone", () => {
    render(<TopBanner />);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByText("pulse")).toBeTruthy();
  });
});
