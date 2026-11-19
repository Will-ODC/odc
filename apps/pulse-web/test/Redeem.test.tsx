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

const checkLink = () => Promise.resolve(ME.email);
const continueButton = () =>
  screen.findByRole("button", { name: `Continue as ${ME.email}` });

describe("opening the emailed link", () => {
  it("says it is working before the server answers", () => {
    render(
      <Redeem
        api={stubApi({ checkLink: () => new Promise(() => {}) })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("spending the token exactly once", () => {
  it("ignores a second press while redemption is pending under StrictMode", async () => {
    let finish!: (me: typeof ME) => void;
    const redeem = vi.fn(
      () => new Promise<typeof ME>((resolve) => (finish = resolve)),
    );
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Redeem
          api={stubApi({ checkLink, redeem })}
          token="abc"
          onSignedIn={onSignedIn}
          onAskAgain={noop}
        />
      </StrictMode>,
    );
    const button = await continueButton();
    expect(redeem).not.toHaveBeenCalled();
    await user.dblClick(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(redeem).toHaveBeenCalledExactlyOnceWith("abc");
    finish(ME);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  /*
   * The app hands in a fresh `onSignedIn` every time it draws, which reruns
   * the effect. Going on twice would read the remembered place a second
   * time, find it already forgotten, and replace it with the default.
   */
  it("goes on once even when handed a new callback after signing in", async () => {
    const first = vi.fn();
    const later = vi.fn();
    const api = stubApi({ checkLink, redeem: () => Promise.resolve(ME) });
    const { rerender } = render(
      <StrictMode>
        <Redeem api={api} token="abc" onSignedIn={first} onAskAgain={noop} />
      </StrictMode>,
    );
    await userEvent.click(await continueButton());
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
            checkLink: () => Promise.reject(new ApiError(410, sentence, code)),
          })}
          token="abc"
          onSignedIn={noop}
          onAskAgain={noop}
        />,
      );
      expect(await screen.findByText(sentence)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Continue as/ })).toBeNull();
    });
  }

  it("shows the server's sentence for a link with no token in it", async () => {
    render(
      <Redeem
        api={stubApi({
          checkLink: () =>
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
          checkLink: () =>
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

  // SignIn.css no longer draws `.signin__go`; the shared Button does (#534).
  it("draws the way out as the shared primary button", async () => {
    render(
      <Redeem
        api={stubApi({
          checkLink: () =>
            Promise.reject(
              new ApiError(410, "That link has expired.", "expired"),
            ),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Ask for a new link",
    });
    expect(button.classList).toContain("btn");
    expect(button.classList).toContain("btn--primary");
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
    stubApi({ checkLink: () => Promise.reject(new TypeError("offline")) });

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
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ME.email);
    const redeem = vi.fn(async () => ME);
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ checkLink: read, redeem })}
        token="abc123"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await screen.findByText("We could not reach pulse.");

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.className).toBe("btn btn--secondary signin__go");
    await userEvent.click(retry);

    const button = await continueButton();
    expect(read.mock.calls).toEqual([["abc123"], ["abc123"]]);
    expect(redeem).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(redeem).toHaveBeenCalledExactlyOnceWith("abc123");
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
          checkLink: () =>
            Promise.reject(
              new ApiError(410, "That link has expired.", "expired"),
            ),
        }),
      "That link did not work.",
    ],
    [
      "a failed request",
      () =>
        stubApi({ checkLink: () => Promise.reject(new TypeError("offline")) }),
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

/*
 * The press reached the server, the server spent the link and set the session
 * cookie, and the answer was lost on the way back. Reposting would only hear
 * "already used", so the screen asks who is signed in instead (GET), and only
 * if that is not the address it offered does it stop. It never reposts.
 */
describe("when the answer to the press is lost", () => {
  const lost = () =>
    Promise.reject(new ApiError(0, "We could not reach pulse."));

  it("goes on when the browser is already signed in as that address", async () => {
    const redeem = vi.fn(lost);
    const me = vi.fn(() => Promise.resolve(ME));
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ checkLink, redeem, me })}
        token="abc"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    expect(me).not.toHaveBeenCalled();
    await userEvent.click(await continueButton());
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(redeem).toHaveBeenCalledExactlyOnceWith("abc");
    expect(me).toHaveBeenCalledTimes(1);
  });

  it("does not go on as somebody else's account", async () => {
    const redeem = vi.fn(lost);
    const me = vi.fn(() =>
      Promise.resolve({ ...ME, email: "someone@student.ubc.ca" }),
    );
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ checkLink, redeem, me })}
        token="abc"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await userEvent.click(await continueButton());
    expect(
      await screen.findByText("We could not finish signing you in."),
    ).toBeTruthy();
    // True whoever /me named, or if it failed: it never claims nobody is in.
    expect(
      screen.getByText(
        `Pulse could not confirm that this browser is signed in as ${ME.email}. Try again to check the link.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/not signed in/)).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  for (const [name, answer] of [
    ["nobody is signed in", () => Promise.resolve(null)],
    ["the check fails too", () => Promise.reject(new ApiError(0, "offline"))],
  ] as const) {
    it(`Try again re-reads the link, never re-posts, when ${name}`, async () => {
      const redeem = vi.fn(lost);
      const read = vi.fn(checkLink);
      const onAskAgain = vi.fn();
      const onSignedIn = vi.fn();
      render(
        <Redeem
          api={stubApi({ checkLink: read, redeem, me: answer })}
          token="abc"
          onSignedIn={onSignedIn}
          onAskAgain={onAskAgain}
        />,
      );
      await userEvent.click(await continueButton());
      await screen.findByText("We could not finish signing you in.");
      expect(
        screen.queryByRole("button", { name: "Ask for a new link" }),
      ).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      await continueButton();
      expect(read.mock.calls).toEqual([["abc"], ["abc"]]);
      expect(redeem).toHaveBeenCalledTimes(1);
      expect(onAskAgain).not.toHaveBeenCalled();
      expect(onSignedIn).not.toHaveBeenCalled();
    });
  }

  it("Try again lands on the used-link view when the link was spent", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(ME.email)
      .mockRejectedValueOnce(
        new ApiError(410, "That link has already been used.", "already_used"),
      );
    const redeem = vi.fn(lost);
    render(
      <Redeem
        api={stubApi({
          checkLink: read,
          redeem,
          me: () => Promise.resolve(null),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    await userEvent.click(await continueButton());
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    expect(
      await screen.findByRole("button", { name: "Ask for a new link" }),
    ).toBeTruthy();
    expect(redeem).toHaveBeenCalledTimes(1);
  });
});

/*
 * Pulse answered the press, and the answer was no (403, 429, 5xx). It was
 * reached, so the heading must not say it was not; the server's sentence and
 * the Try again control stay.
 */
describe("when Pulse answers the press with a refusal", () => {
  for (const status of [403, 429, 503]) {
    it(`does not blame the connection for a ${status}`, async () => {
      const redeem = vi.fn(() =>
        Promise.reject(new ApiError(status, "Too many tries. Wait a moment.")),
      );
      const me = vi.fn(() => Promise.resolve(null));
      render(
        <Redeem
          api={stubApi({ checkLink, redeem, me })}
          token="abc"
          onSignedIn={noop}
          onAskAgain={noop}
        />,
      );
      await userEvent.click(await continueButton());
      expect(
        await screen.findByText("Pulse could not sign you in."),
      ).toBeTruthy();
      expect(screen.getByText("Too many tries. Wait a moment.")).toBeTruthy();
      expect(screen.queryByText("We could not reach pulse.")).toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(me).not.toHaveBeenCalled();
      expect(redeem).toHaveBeenCalledTimes(1);
    });
  }
});

// The live region wraps the heading and the line under it; it must space
// them the way the column spaces the email-entry screen's, not run them on.
describe("spacing inside the announced block", () => {
  it("gives the confirm and stopped blocks the spaced wrapper", async () => {
    render(
      <Redeem
        api={stubApi({ checkLink })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    const heading = await screen.findByText("Sign in to Pulse");
    expect(heading.closest('[role="status"]')?.classList).toContain(
      "signin__said",
    );
    cleanup();
    render(
      <Redeem
        api={stubApi({
          checkLink: () => Promise.reject(new ApiError(0, "offline")),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    const stopped = await screen.findByText("We could not reach pulse.");
    expect(stopped.closest('[role="status"]')?.classList).toContain(
      "signin__said",
    );
  });
});
