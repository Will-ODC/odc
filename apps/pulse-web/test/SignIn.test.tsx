// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import { SignIn } from "../src/screens/SignIn.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);

const field = () => screen.getByLabelText("Your school email");
const go = () => screen.getByRole("button", { name: "Continue" });

/*
 * What `POST /api/sign-in` really answers with. The message is a hardcoded
 * literal in `apps/pulse/src/http/server.ts`, sent on EVERY success, so a stub
 * without it is a body the server cannot produce — and five of these tests
 * used one, which is how the screen that ships ended up being the untested
 * half. Anything asserted against this is asserted against production.
 */
const SERVER_SENT = {
  status: "sent" as const,
  message: "Check your email for a link to sign in.",
};

describe("asking for a link", () => {
  it("sends the address and the opt-in the person actually gave", async () => {
    const requestLink = vi.fn(() => Promise.resolve(SERVER_SENT));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(screen.getByLabelText(/Email me once/));
    await userEvent.click(go());

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", true);
  });

  /*
   * `proofEmailsOptIn` is an opt-in, so the untouched box has to travel as a
   * real `false`. Defaulting it anywhere else would opt people in by omission.
   */
  it("sends false when the box was never touched", async () => {
    const requestLink = vi.fn(() => Promise.resolve(SERVER_SENT));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", false);
  });

  it("trims space the person did not mean to type", async () => {
    const requestLink = vi.fn(() => Promise.resolve(SERVER_SENT));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "  jo@student.ubc.ca ");
    await userEvent.click(go());

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", false);
  });

  it("can be sent from the keyboard alone", async () => {
    const requestLink = vi.fn(() => Promise.resolve(SERVER_SENT));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.tab();
    await userEvent.keyboard("jo@student.ubc.ca{Enter}");

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", false);
  });
});

describe("while it is sending", () => {
  it("says so and refuses a second press", async () => {
    const requestLink = vi.fn(() => new Promise<never>(() => {}));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect(sending.hasAttribute("disabled")).toBe(true);
    await userEvent.click(sending);
    expect(requestLink).toHaveBeenCalledTimes(1);
  });
});

describe("once the link is on its way", () => {
  it("names the address back so a typo is obvious", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () => Promise.resolve(SERVER_SENT),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(screen.getByText("jo@student.ubc.ca")).toBeTruthy();
  });

  /*
   * The server's sentence is a hardcoded literal that duplicates the heading
   * and does not name the address, so this screen deliberately does not show
   * it. Asserting its ABSENCE is what stops someone reinstating it and giving
   * the person "Check your email." twice.
   */
  it("does not repeat the server's sentence back", async () => {
    render(
      <SignIn
        api={stubApi({ requestLink: () => Promise.resolve(SERVER_SENT) })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());
    await screen.findByText("Check your email.");

    expect(screen.queryByText(SERVER_SENT.message)).toBeNull();
  });

  /*
   * A 429 is good news wearing an error status — the link is already on its
   * way. Answering it as a failure would tell someone their request did not
   * work when it worked twice.
   */
  it("treats an already-sent link as sent, not as a failure", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.reject(
              new ApiError(
                429,
                "A link is already on its way. Check your email.",
                "link_already_sent",
              ),
            ),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(screen.getByText("jo@student.ubc.ca")).toBeTruthy();
  });

  /*
   * The other 429, and the reason the first one cannot be matched on status.
   * The rate limiter refuses without sending anything, so showing the "check
   * your email" screen here strands the person waiting for a mail that is not
   * coming. It must read as the failure it is.
   */
  it("treats a rate-limited request as a failure, not as sent", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.reject(
              new ApiError(
                429,
                "Too many tries just now. Try again a little later.",
                "too_many_requests",
              ),
            ),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(
      await screen.findByText(
        "Too many tries just now. Try again a little later.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Check your email.")).toBeNull();
  });

  /*
   * The form that was focused has just unmounted. Without moving focus it
   * falls to `document.body`: a keyboard user tabs from the top of the page to
   * reach the only control, and a screen reader announces nothing.
   */
  it("moves focus to the heading rather than dropping it", async () => {
    render(
      <SignIn
        api={stubApi({ requestLink: () => Promise.resolve(SERVER_SENT) })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    const heading = await screen.findByText("Check your email.");
    // Focus moves in an effect after the heading renders; wait for it rather
    // than racing it (the same race failed Redeem's test on CI in #154).
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("puts focus back in the field when they come back to change it", async () => {
    render(
      <SignIn
        api={stubApi({ requestLink: () => Promise.resolve(SERVER_SENT) })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());
    await screen.findByText("Check your email.");

    await userEvent.click(
      screen.getByRole("button", { name: "Use a different email" }),
    );

    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("lets someone go back and use a different address", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () => Promise.resolve(SERVER_SENT),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());
    await screen.findByText("Check your email.");

    await userEvent.click(
      screen.getByRole("button", { name: "Use a different email" }),
    );

    expect(await screen.findByLabelText("Your school email")).toBeTruthy();
  });
});

describe("when the address will not do", () => {
  /*
   * An unclaimed domain is an answer, not a fault: the server names the domain
   * and that sentence is exactly what the person needs. Shown as-is.
   */
  it("shows the server's sentence for a domain no community owns", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.resolve({
              status: "not_eligible" as const,
              message: "No community uses gmail.com yet.",
            }),
        })}
      />,
    );

    await userEvent.type(field(), "jo@gmail.com");
    await userEvent.click(go());

    expect(
      await screen.findByText("No community uses gmail.com yet."),
    ).toBeTruthy();
    // Still on the form: the next thing to do is try another address.
    expect(screen.getByLabelText("Your school email")).toBeTruthy();
  });

  it("shows one plain sentence when the request fails outright", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.reject(new ApiError(0, "Couldn't reach pulse.")),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(await screen.findByText("Couldn't reach pulse.")).toBeTruthy();
  });

  /*
   * A request that did not get through is not the field's fault. Marking the
   * input invalid and describing it with "we could not reach pulse" tells a
   * screen-reader user to fix an address that is perfectly good.
   */
  it("does not blame the field when it was the request that failed", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.reject(new ApiError(0, "Couldn't reach pulse.")),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());
    await screen.findByText("Couldn't reach pulse.");

    expect(field().getAttribute("aria-invalid")).toBe("false");
    expect(field().getAttribute("aria-describedby")).toBeNull();
  });

  /*
   * A refusal naming the old domain is stale the moment they start replacing
   * it — and leaving `aria-invalid` on marks the new address wrong before it
   * has been sent anywhere.
   */
  it("drops the refusal once they start changing the address", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.resolve({
              status: "not_eligible" as const,
              message: "No community uses gmail.com yet.",
            }),
        })}
      />,
    );

    await userEvent.type(field(), "jo@gmail.com");
    await userEvent.click(go());
    await screen.findByText("No community uses gmail.com yet.");

    await userEvent.type(field(), "x");

    await waitFor(() =>
      expect(screen.queryByText("No community uses gmail.com yet.")).toBeNull(),
    );
    expect(field().getAttribute("aria-invalid")).toBe("false");
  });
});

describe("checking the field", () => {
  /*
   * On blur, never on keystroke. Telling someone their address is malformed
   * while they are still typing it is telling them off for not having finished
   * — and the assertion that would go red if this moved to onChange is the
   * one that types a whole valid address a character at a time.
   */
  it("stays quiet while the address is being typed", async () => {
    render(<SignIn api={stubApi()} />);
    /*
     * Deliberately stopped part-way, and deliberately invalid as it stands:
     * "jo@ubc" is what "jo@ubc.ca" looks like three keystrokes from done.
     * Typing the whole valid address instead proves nothing — it is valid by
     * the time the assertion runs, so the test passes even if the check moved
     * to onChange, which is exactly what it went green for once.
     */
    await userEvent.type(field(), "jo@ubc");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBe("false");
  });

  it("says so once they leave a malformed address", async () => {
    render(<SignIn api={stubApi()} />);
    await userEvent.type(field(), "jo@ubc");
    await userEvent.tab();
    expect(
      await screen.findByText("That does not look like an email address."),
    ).toBeTruthy();
    /*
     * Asserted POSITIVELY, and that matters: the two neighbouring tests check
     * `queryByRole("alert")` is null, so deleting `role="alert"` from the
     * markup made both of them pass forever and never fail again. Something
     * has to require the role to be there.
     */
    expect(screen.getByRole("alert").textContent).toBe(
      "That does not look like an email address.",
    );
  });

  it("says nothing about an empty field they merely passed through", async () => {
    render(<SignIn api={stubApi()} />);
    await userEvent.click(field());
    await userEvent.tab();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never sends a malformed address", async () => {
    const requestLink = vi.fn(() => Promise.resolve(SERVER_SENT));
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "jo@ubc");
    await userEvent.click(go());

    expect(requestLink).not.toHaveBeenCalled();
    expect(
      await screen.findByText("That does not look like an email address."),
    ).toBeTruthy();
  });

  it("clears the complaint once they start fixing it", async () => {
    render(<SignIn api={stubApi()} />);
    await userEvent.type(field(), "jo@ubc");
    await userEvent.tab();
    await screen.findByText("That does not look like an email address.");

    await userEvent.type(field(), ".ca");

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("points the field at the sentence explaining it", async () => {
    render(<SignIn api={stubApi()} />);
    await userEvent.type(field(), "jo@ubc");
    await userEvent.tab();

    const described = field().getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(described ?? "")?.textContent).toBe(
      "That does not look like an email address.",
    );
  });
});
