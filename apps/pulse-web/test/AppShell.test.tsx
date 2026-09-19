// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "../src/components/AppShell.js";

afterEach(cleanup);

describe("the room the phone sits in", () => {
  it("puts the screen it is given in the main region", () => {
    render(
      <AppShell>
        <p>the ballot</p>
      </AppShell>,
    );
    expect(screen.getByRole("main").textContent).toBe("the ballot");
  });

  it("stands a bar on top and a rail on either side when it is given them", () => {
    render(
      <AppShell
        banner={<p>the bar</p>}
        nav={<nav aria-label="Answered" />}
        aside={<aside />}
      >
        <p>the ballot</p>
      </AppShell>,
    );
    expect(screen.getByText("the bar")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Answered" })).toBeTruthy();
    expect(screen.getByRole("complementary")).toBeTruthy();
  });

  /*
   * Not a styling detail: a screen with nothing to put beside it must not get
   * an empty box holding the space open, because the phone would then sit off
   * centre on a wide window with no way to tell why.
   */
  it("renders no rail at all for a screen that has none", () => {
    const { container } = render(
      <AppShell>
        <p>the ballot</p>
      </AppShell>,
    );
    expect(container.querySelectorAll(".shell__rail").length).toBe(0);
  });
});
