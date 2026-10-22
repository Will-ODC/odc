// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { Route } from "../src/flow/route.js";
import { stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
const routes: Route[] = [
  { kind: "welcome" },
  { kind: "progress" },
  { kind: "questions" },
  { kind: "trust" },
  { kind: "signIn" },
  { kind: "newPoll" },
  { kind: "browse", community: "demo-community" },
  { kind: "conversation", pollId: "ads-free" },
];
it.each(routes)(
  "keeps shared navigation and the real account on $kind",
  async (route) => {
    const user = userEvent.setup();
    render(
      <App
        route={route}
        api={stubApi({
          me: async () => ({
            id: "alice",
            email: "alice@example.test",
            community: "demo-community",
          }),
          listPolls: async () => ({ polls: [], nextCursor: null }),
        })}
      />,
    );
    const header = within(screen.getByRole("banner"));
    const nav = within(
      header.getByRole("navigation", { name: "Main navigation" }),
    );
    expect(nav.getByRole("link", { name: "Home" }).getAttribute("href")).toBe(
      "/",
    );
    expect(
      nav
        .getByRole("link", { name: "Starting questions" })
        .getAttribute("href"),
    ).toBe("/questions");
    expect(
      nav.getByRole("link", { name: "General" }).getAttribute("href"),
    ).toBe("/browse?community=pulse-general");
    expect(
      (await nav.findByRole("link", { name: "Your community" })).getAttribute(
        "href",
      ),
    ).toBe("/browse?community=demo-community");
    expect(
      header
        .getByRole("link", { name: "Post a question" })
        .getAttribute("href"),
    ).toBe("/new");
    await user.click(header.getByRole("button", { name: "Account" }));
    expect(header.getByText("alice@example.test")).toBeTruthy();
  },
);

it("marks the current community in the shared navigation", async () => {
  render(
    <App
      route={{ kind: "browse", community: "pulse-general" }}
      api={stubApi({
        listPolls: async () => ({ polls: [], nextCursor: null }),
      })}
    />,
  );
  expect(
    screen.getByRole("link", { name: "General" }).getAttribute("aria-current"),
  ).toBe("page");
});
