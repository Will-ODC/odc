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

describe("asking for a link", () => {
  it("sends the address and the opt-in the person actually gave", async () => {
    const requestLink = vi.fn(() =>
      Promise.resolve({ status: "sent" as const }),
    );
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
    const requestLink = vi.fn(() =>
      Promise.resolve({ status: "sent" as const }),
    );
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", false);
  });

  it("trims space the person did not mean to type", async () => {
    const requestLink = vi.fn(() =>
      Promise.resolve({ status: "sent" as const }),
    );
    render(<SignIn api={stubApi({ requestLink })} />);

    await userEvent.type(field(), "  jo@student.ubc.ca ");
    await userEvent.click(go());

    expect(requestLink).toHaveBeenCalledWith("jo@student.ubc.ca", false);
  });

  it("can be sent from the keyboard alone", async () => {
    const requestLink = vi.fn(() =>
      Promise.resolve({ status: "sent" as const }),
    );
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
          requestLink: () => Promise.resolve({ status: "sent" as const }),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(screen.getByText("jo@student.ubc.ca")).toBeTruthy();
  });

  /*
   * The server's sentence knows things this screen does not — how long the
   * link lasts, for one. Carried rather than replaced with our own wording.
   */
  it("shows the server's own sentence when it sent one", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () =>
            Promise.resolve({
              status: "sent" as const,
              message: "Check your email. The link works for 15 minutes.",
            }),
        })}
      />,
    );

    await userEvent.type(field(), "jo@student.ubc.ca");
    await userEvent.click(go());

    expect(
      await screen.findByText(
        "Check your email. The link works for 15 minutes.",
      ),
    ).toBeTruthy();
  });

  it("lets someone go back and use a different address", async () => {
    render(
      <SignIn
        api={stubApi({
          requestLink: () => Promise.resolve({ status: "sent" as const }),
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
  });

  it("says nothing about an empty field they merely passed through", async () => {
    render(<SignIn api={stubApi()} />);
    await userEvent.click(field());
    await userEvent.tab();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never sends a malformed address", async () => {
    const requestLink = vi.fn(() =>
      Promise.resolve({ status: "sent" as const }),
    );
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
