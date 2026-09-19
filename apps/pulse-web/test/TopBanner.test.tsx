// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
   * The way in is replaced, not accompanied. Offering "Sign in" beside a mark
   * saying you already are is the contradiction this rule exists to prevent.
   */
  it("shows who is signed in instead of the way in", () => {
    render(<TopBanner signInHref="/sign-in" identity={<span>you</span>} />);
    expect(screen.getByText("you")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});
