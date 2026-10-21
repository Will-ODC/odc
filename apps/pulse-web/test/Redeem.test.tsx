// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import { Redeem } from "../src/screens/Redeem.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);

const ME = { id: "v1", email: "jo@student.ubc.ca", community: "ubc" };
const noop = () => {};

describe("opening the emailed link", () => {
  it("says it is working before the server answers", () => {
    render(
      <Redeem
        api={stubApi({ redeem: () => new Promise(() => {}) })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("spends the token it was given", async () => {
    const redeem = vi.fn(() => Promise.resolve(ME));
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ redeem })}
        token="abc123"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(redeem).toHaveBeenCalledWith("abc123");
  });

  /*
   * No "You are in · Continue" screen (operator walkthrough, 2026-10-21):
   * signing in goes straight on to where the person was, once.
   */
  it("goes straight on, once, without a screen to press through", async () => {
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ redeem: () => Promise.resolve(ME) })}
        token="abc"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByText("You are in.")).toBeNull();
  });
});

/*
 * The guard this suite exists for.
 *
 * `POST /api/sign-in/redeem` spends the link, so a second call can only answer
 * `410 already_used`. StrictMode runs every effect twice in development on
 * purpose — so without the once-only guard, every developer who clicked a link
 * in dev would be told it was already used, by their own second request.
 *
 * Drop the `sent` ref in use-redeem.ts and this test goes red on two calls.
 * Replace it with an early return instead — the obvious fix, and the one
 * written first — and it goes red the other way: StrictMode's cleanup marks
 * the first run dead, so nobody is listening and the screen never leaves
 * "Loading…". Both failures are real, which is why this test drives the whole
 * StrictMode double-mount rather than asserting a call count on a bare render.
 */
describe("spending the token exactly once", () => {
  it("redeems once even though StrictMode runs the effect twice", async () => {
    const redeem = vi.fn(() => Promise.resolve(ME));
    const onSignedIn = vi.fn();
    render(
      <StrictMode>
        <Redeem
          api={stubApi({ redeem })}
          token="abc"
          onSignedIn={onSignedIn}
          onAskAgain={noop}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(redeem).toHaveBeenCalledTimes(1);
    // Where to return is read and forgotten in `onSignedIn`: twice would
    // send the second call to the default.
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  /*
   * The app hands in a fresh `onSignedIn` every time it draws, which reruns
   * the effect. Going on twice would read the remembered place a second
   * time, find it already forgotten, and replace it with the default.
   */
  it("goes on once even when handed a new callback after signing in", async () => {
    const first = vi.fn();
    const later = vi.fn();
    const api = stubApi({ redeem: () => Promise.resolve(ME) });
    const { rerender } = render(
      <StrictMode>
        <Redeem api={api} token="abc" onSignedIn={first} onAskAgain={noop} />
      </StrictMode>,
    );
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    rerender(
      <StrictMode>
        <Redeem api={api} token="abc" onSignedIn={later} onAskAgain={noop} />
      </StrictMode>,
    );
    expect(later).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("when the link has run out", () => {
  /*
   * Three ways a link stops working, and only the server knows which. Its own
   * sentence names it and says what to do, so it is shown rather than replaced
   * — anything this screen invented would have to guess between the three.
   */
  const gone = [
    ["already_used", "That link has already been used. Ask for a new one."],
    ["expired", "That link has expired. Ask for a new one."],
    ["unknown_link", "That link is not one of ours. Ask for a new one."],
  ] as const;

  for (const [code, sentence] of gone) {
    it(`shows the server's sentence for ${code}`, async () => {
      render(
        <Redeem
          api={stubApi({
            redeem: () => Promise.reject(new ApiError(410, sentence, code)),
          })}
          token="abc"
          onSignedIn={noop}
          onAskAgain={noop}
        />,
      );
      expect(await screen.findByText(sentence)).toBeTruthy();
    });
  }

  it("shows the server's sentence for a link with no token in it", async () => {
    render(
      <Redeem
        api={stubApi({
          redeem: () =>
            Promise.reject(
              new ApiError(400, "That link is incomplete.", "bad_request"),
            ),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(await screen.findByText("That link is incomplete.")).toBeTruthy();
  });

  it("offers the way out the sentence tells them to take", async () => {
    const onAskAgain = vi.fn();
    render(
      <Redeem
        api={stubApi({
          redeem: () =>
            Promise.reject(
              new ApiError(410, "That link has expired.", "expired"),
            ),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={onAskAgain}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Ask for a new link" }),
    );
    expect(onAskAgain).toHaveBeenCalledTimes(1);
  });
});

/*
 * The distinction this screen turns on, and the one a review found it was
 * rendering identically to the spent-link case.
 *
 * The request never reached the server, so **the token was never spent**. It
 * is still sitting in the URL and still works. Offering "Ask for a new link"
 * here throws away a working link, and can then run the person into the
 * outstanding-link cap, which answers 429. The only correct control is one
 * that asks again with the token still in hand.
 */
describe("when the server cannot be reached", () => {
  const offline = () =>
    stubApi({ redeem: () => Promise.reject(new TypeError("offline")) });

  it("blames the connection, not the link", async () => {
    render(
      <Redeem
        api={offline()}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(await screen.findByText("We could not reach pulse.")).toBeTruthy();
    expect(screen.getByText(/Your link is still good\./)).toBeTruthy();
  });

  it("never offers to throw the working token away", async () => {
    const onAskAgain = vi.fn();
    render(
      <Redeem
        api={offline()}
        token="abc"
        onSignedIn={noop}
        onAskAgain={onAskAgain}
      />,
    );
    await screen.findByText("We could not reach pulse.");

    expect(
      screen.queryByRole("button", { name: "Ask for a new link" }),
    ).toBeNull();
    expect(onAskAgain).not.toHaveBeenCalled();
  });

  it("asks again with the same token when they retry", async () => {
    const redeem = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ME);
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ redeem })}
        token="abc123"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await screen.findByText("We could not reach pulse.");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(redeem).toHaveBeenLastCalledWith("abc123");
  });
});

/*
 * `<ViewState>` announces "Loading…" through a live region. The branches that
 * replace it were rendering a bare heading with no region at all, so a screen
 * reader was left on "Loading…" and never told what happened — and focus fell
 * to `document.body` in every case.
 */
describe("telling somebody who cannot see the screen", () => {
  const cases = [
    [
      "a spent link",
      () =>
        stubApi({
          redeem: () =>
            Promise.reject(
              new ApiError(410, "That link has expired.", "expired"),
            ),
        }),
      "That link did not work.",
    ],
    [
      "a failed request",
      () => stubApi({ redeem: () => Promise.reject(new TypeError("offline")) }),
      "We could not reach pulse.",
    ],
  ] as const;

  for (const [name, api, title] of cases) {
    it(`announces ${name} and moves focus to it`, async () => {
      render(
        <Redeem api={api()} token="abc" onSignedIn={noop} onAskAgain={noop} />,
      );
      const heading = await screen.findByText(title);
      // Focus moves in an effect that runs after the heading renders, so
      // wait for it: asserting straight after `findByText` races the effect
      // and failed on CI (#154) while passing locally.
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(heading.closest('[role="status"]')).toBeTruthy();
    });
  }
});
