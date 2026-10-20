// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { poll, stubApi } from "./stub-api.js";

afterEach(cleanup);
beforeEach(() => {
  globalThis.history.replaceState(null, "", "/");
  globalThis.localStorage.clear();
});

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
    expect(await screen.findByLabelText("Your email")).toBeTruthy();
  });

  it("opens the conversation at an explicit default-poll link", async () => {
    globalThis.history.replaceState(null, "", "/?poll=ads-free");
    render(<App api={stubApi()} />);
    /*
     * In the ballot, not on the page: the left rail lists the questions
     * answered so far, so the run's question is legitimately on screen twice
     * and an unscoped query finds both. Racy rather than always red — the
     * rail's wording arrives from an effect — which is exactly the kind of
     * intermittent failure that gets misread as somebody else's flake.
     */
    expect(
      await within(screen.getByRole("main")).findByText(poll().question),
    ).toBeTruthy();
    expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Vote" })).toBeTruthy();
  });

  it("opens the conversation wherever ?poll= says", async () => {
    const listed = poll({
      id: "pay-for-it",
      question: "How do we pay for it?",
    });
    const byId = vi.fn(() => Promise.resolve(listed));
    globalThis.history.replaceState(null, "", "/?poll=pay-for-it");

    render(<App api={stubApi({ poll: byId })} />);

    expect(await screen.findByText("How do we pay for it?")).toBeTruthy();
    expect(byId).toHaveBeenCalledWith("pay-for-it");
    expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
  });
});

describe("the chat preview", () => {
  it("opens at /preview/chat without asking the server for anything", async () => {
    globalThis.history.replaceState(null, "", "/preview/chat");
    const poll = vi.fn();
    const cast = vi.fn();
    const me = vi.fn();
    render(<App api={stubApi({ poll, cast, me })} />);

    expect(await screen.findByText("Preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
    expect(poll).not.toHaveBeenCalled();
    expect(cast).not.toHaveBeenCalled();
    expect(me).not.toHaveBeenCalled();
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

    /*
     * In the ballot, not on the page: the left rail lists the questions
     * answered so far, so the run's question is legitimately on screen twice
     * and an unscoped query finds both. Racy rather than always red — the
     * rail's wording arrives from an effect — which is exactly the kind of
     * intermittent failure that gets misread as somebody else's flake.
     */
    expect(
      await within(screen.getByRole("main")).findByText(poll().question),
    ).toBeTruthy();
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/?poll=ads-free",
    );
    expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
    /*
     * The length, not the address. Pushing lands on "/" too, so asserting the
     * URL alone is a test that cannot fail — it passed with `go` in place of
     * `replace`, which is the whole bug. What separates them is whether the
     * spent link is still one press of Back away.
     */
    expect(globalThis.history.length).toBe(before);
  });

  /*
   * "Confirm with your email" opens /sign-in?poll=<id>; the emailed link
   * cannot carry the poll, so this browser remembers it (#353).
   */
  it("lands on the question 'Confirm with your email' was pressed on", async () => {
    globalThis.history.replaceState(null, "", "/sign-in?poll=parks");
    const first = render(<App api={stubApi()} />);
    expect(await screen.findByLabelText("Your email")).toBeTruthy();
    first.unmount();

    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(
      <App
        api={stubApi({
          redeem: () => Promise.resolve(ME),
          poll: (id) => Promise.resolve(poll({ id, question: `Q ${id}` })),
        })}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );
    expect(
      await within(screen.getByRole("main")).findByText("Q parks"),
    ).toBeTruthy();
    expect(globalThis.location.search).toBe("?poll=parks");
    // Other tabs in this browser hear about it (#353).
    expect(globalThis.localStorage.getItem("pulse.signedIn")).toMatch(/^\d+$/);
  });

  it("lands where it always has when sign-in named no question", async () => {
    globalThis.history.replaceState(null, "", "/sign-in?poll=parks");
    const first = render(<App api={stubApi()} />);
    await screen.findByLabelText("Your email");
    first.unmount();
    // A later, plain sign-in forgets the older question.
    globalThis.history.replaceState(null, "", "/sign-in");
    const second = render(<App api={stubApi()} />);
    await screen.findByLabelText("Your email");
    second.unmount();

    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(<App api={stubApi({ redeem: () => Promise.resolve(ME) })} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );
    await within(screen.getByRole("main")).findByText(poll().question);
    expect(globalThis.location.search).toBe("?poll=ads-free");
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

    const before = globalThis.history.length;
    await userEvent.click(
      await screen.findByRole("button", { name: "Ask for a new link" }),
    );

    expect(await screen.findByLabelText("Your email")).toBeTruthy();
    expect(globalThis.location.pathname).toBe("/sign-in");
    expect(globalThis.location.search).toBe("");
    /*
     * The same assertion the sibling test needed, for the same reason: without
     * it, `go` in place of `replace` passes, and Back from the sign-in form
     * lands on the dead token URL. A review found this call site after the
     * other one had already been swept for exactly this.
     */
    expect(globalThis.history.length).toBe(before);
  });
});

/*
 * Nothing in the app pushes a history entry today — every move is a `replace`
 * away from a URL that must not come back — so the browser's own back and
 * forward buttons cannot currently reach another screen from inside pulse.
 *
 * The listener is kept anyway, and tested here, because the moment anything
 * does push (the home feed and the run's own navigation are both coming) a
 * missing listener means Back changes the URL and leaves the screen behind.
 * Without this test that listener is deletable with the whole suite green —
 * which a review found it was.
 */
describe("following the browser's own navigation", () => {
  it("re-reads the URL when the browser moves", async () => {
    globalThis.history.replaceState(null, "", "/?poll=ads-free");
    render(<App api={stubApi()} />);
    await screen.findByText(poll().question);

    globalThis.history.replaceState(null, "", "/sign-in");
    globalThis.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByLabelText("Your email")).toBeTruthy();
  });
});

/*
 * The prop exists so a test can render one screen without driving history.
 * It must not become the only path that works — see the suite above, which
 * deliberately does not use it.
 */
/*
 * Signing in used to be the one place the desktop page did not reach: the
 * screens drew a bare phone frame with no bar over it, and on a wide window
 * that frame sat against the left edge. Both sign-in screens now stand in the
 * same page the ballot does. The layout itself is CSS and jsdom cannot see it;
 * what it can see is that they are in the page at all.
 */
describe("the sign-in screens on the page", () => {
  it("puts the form in the page, under the bar", async () => {
    globalThis.history.replaceState(null, "", "/sign-in");
    render(<App api={stubApi()} />);

    const main = screen.getByRole("main");
    expect(await within(main).findByLabelText("Your email")).toBeTruthy();
    expect(
      screen.getByText("pulse", { selector: ".banner__brand" }),
    ).toBeTruthy();
  });

  it("does not offer a way in to someone already on the way in", async () => {
    globalThis.history.replaceState(null, "", "/sign-in");
    render(<App api={stubApi()} />);
    await screen.findByLabelText("Your email");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("puts what the emailed link opens in the page too", async () => {
    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(<App api={stubApi({ redeem: () => Promise.resolve(ME) })} />);

    expect(
      await within(screen.getByRole("main")).findByText("You are in."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

describe("a route handed in directly", () => {
  it("wins over the URL", async () => {
    globalThis.history.replaceState(null, "", "/sign-in");
    render(
      <App
        api={stubApi()}
        route={{ kind: "conversation", pollId: "ads-free" }}
      />,
    );
    /*
     * In the ballot, not on the page: the left rail lists the questions
     * answered so far, so the run's question is legitimately on screen twice
     * and an unscoped query finds both. Racy rather than always red — the
     * rail's wording arrives from an effect — which is exactly the kind of
     * intermittent failure that gets misread as somebody else's flake.
     */
    expect(
      await within(screen.getByRole("main")).findByText(poll().question),
    ).toBeTruthy();
  });
});

it("opens live voting at /conversation while the prototype remains separate", async () => {
  globalThis.history.replaceState(null, "", "/conversation?poll=ads-free");
  const byId = vi.fn(async () => poll());
  render(<App api={stubApi({ poll: byId })} />);
  expect(
    await within(screen.getByRole("main")).findByRole("heading", {
      name: poll().question,
      level: 1,
    }),
  ).toBeTruthy();
  expect(byId).toHaveBeenCalledWith("ads-free");
  expect(screen.queryByText("Preview")).toBeNull();
});
