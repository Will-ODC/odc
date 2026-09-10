// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
    render(
      <Redeem
        api={stubApi({ redeem })}
        token="abc123"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    await screen.findByText("You are in.");
    expect(redeem).toHaveBeenCalledWith("abc123");
  });

  /*
   * The link is the one moment pulse knows which address it reached, and
   * someone with two accounts needs to see which one they just used.
   */
  it("names the address it signed them in as", async () => {
    render(
      <Redeem
        api={stubApi({ redeem: () => Promise.resolve(ME) })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(await screen.findByText("jo@student.ubc.ca")).toBeTruthy();
  });

  it("moves on when they press Continue", async () => {
    const onSignedIn = vi.fn();
    render(
      <Redeem
        api={stubApi({ redeem: () => Promise.resolve(ME) })}
        token="abc"
        onSignedIn={onSignedIn}
        onAskAgain={noop}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );
    expect(onSignedIn).toHaveBeenCalledTimes(1);
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
    render(
      <StrictMode>
        <Redeem
          api={stubApi({ redeem })}
          token="abc"
          onSignedIn={noop}
          onAskAgain={noop}
        />
      </StrictMode>,
    );
    await screen.findByText("You are in.");
    expect(redeem).toHaveBeenCalledTimes(1);
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

describe("when the server cannot be reached", () => {
  it("shows one plain sentence and a way to try again", async () => {
    render(
      <Redeem
        api={stubApi({
          redeem: () => Promise.reject(new TypeError("offline")),
        })}
        token="abc"
        onSignedIn={noop}
        onAskAgain={noop}
      />,
    );
    expect(
      await screen.findByText(
        "We could not sign you in. Check your connection and try again.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ask for a new link" }),
    ).toBeTruthy();
  });
});
