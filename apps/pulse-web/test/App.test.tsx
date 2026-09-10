// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { App } from "../src/App.js";
import { installPointerEvents, poll, stubApi } from "./stub-api.js";

beforeAll(installPointerEvents);
afterEach(cleanup);
beforeEach(() => globalThis.history.replaceState(null, "", "/"));

const ME = { id: "v1", email: "jo@student.ubc.ca", community: "ubc" };

/*
 * The break this file exists to hold shut.
 *
 * The server emails `<web origin>/sign-in?token=…`. Before routing, the app
 * read the URL for `?poll=`, found nothing, and opened the first question — so
 * clicking a sign-in link signed nobody in and said nothing about it. Every
 * test here drives the real URL rather than passing a route in, because the
 * bug was in the reading of the URL, and a test that skips that step would
 * have passed the whole time it was broken.
 */
describe("what the URL opens", () => {
  it("spends the token from the emailed link", async () => {
    const redeem = vi.fn(() => Promise.resolve(ME));
    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");

    render(<App api={stubApi({ redeem })} />);

    expect(await screen.findByText("You are in.")).toBeTruthy();
    expect(redeem).toHaveBeenCalledWith("abc123");
  });

  it("asks for a link when /sign-in carries no token", async () => {
    globalThis.history.replaceState(null, "", "/sign-in");
    render(<App api={stubApi()} />);
    expect(await screen.findByLabelText("Your school email")).toBeTruthy();
  });

  it("opens the run at the bare path", async () => {
    render(<App api={stubApi()} />);
    expect(await screen.findByText(poll().question)).toBeTruthy();
  });

  it("starts the run wherever ?poll= says", async () => {
    const listed = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
    });
    const byId = vi.fn(() => Promise.resolve(listed));
    globalThis.history.replaceState(null, "", "/?poll=pay-for-it");

    render(<App api={stubApi({ poll: byId })} />);

    expect(await screen.findByText("How do we pay for it?")).toBeTruthy();
    expect(byId).toHaveBeenCalledWith("pay-for-it");
  });
});

describe("after the link is spent", () => {
  /*
   * The token is gone the moment it is redeemed, so the URL that carried it
   * can now only answer "already used". Replacing rather than pushing keeps it
   * out of the back button — press back from here and you leave pulse, which
   * is honest, rather than landing on a link that is guaranteed to fail.
   */
  it("leaves no spent link behind in the history", async () => {
    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(<App api={stubApi({ redeem: () => Promise.resolve(ME) })} />);
    const before = globalThis.history.length;

    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );

    expect(await screen.findByText(poll().question)).toBeTruthy();
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/");
    /*
     * The length, not the address. Pushing lands on "/" too, so asserting the
     * URL alone is a test that cannot fail — it passed with `go` in place of
     * `replace`, which is the whole bug. What separates them is whether the
     * spent link is still one press of Back away.
     */
    expect(globalThis.history.length).toBe(before);
  });

  it("goes back to the form when the link had run out", async () => {
    const { ApiError } = await import("../src/api/types.js");
    globalThis.history.replaceState(null, "", "/sign-in?token=stale");
    render(
      <App
        api={stubApi({
          redeem: () =>
            Promise.reject(
              new ApiError(
                410,
                "That link has expired. Ask for a new one.",
                "expired",
              ),
            ),
        })}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Ask for a new link" }),
    );

    expect(await screen.findByLabelText("Your school email")).toBeTruthy();
    expect(globalThis.location.pathname).toBe("/sign-in");
    expect(globalThis.location.search).toBe("");
  });
});

/*
 * The prop exists so a test can render one screen without driving history.
 * It must not become the only path that works — see the suite above, which
 * deliberately does not use it.
 */
describe("a route handed in directly", () => {
  it("wins over the URL", async () => {
    globalThis.history.replaceState(null, "", "/sign-in");
    render(<App api={stubApi()} route={{ kind: "run", pollId: "ads-free" }} />);
    expect(await screen.findByText(poll().question)).toBeTruthy();
  });
});
