// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseApi } from "../src/api/types.js";
import { App } from "../src/App.js";
import { Trust } from "../src/screens/Trust.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => globalThis.history.replaceState(null, "", "/"));

/** Every method a spy, so a test can say none of them was called. */
function watchedApi(): { api: PulseApi; calls: () => number } {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  const api = new Proxy({} as PulseApi, {
    get(_target, name: string) {
      let spy = spies.get(name);
      if (!spy) {
        spy = vi.fn(() => Promise.reject(new Error(`called ${name}`)));
        spies.set(name, spy);
      }
      return spy;
    },
  });
  return {
    api,
    calls: () =>
      [...spies.values()].reduce((sum, spy) => sum + spy.mock.calls.length, 0),
  };
}

const REPO = "https://github.com/Will-ODC/odc";

describe("the trust page's own address (#351)", () => {
  it("opens at /trust with no sign-in and no API calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { api, calls } = watchedApi();
    globalThis.history.replaceState(null, "", "/trust");

    render(<App api={api} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Why you can trust your vote",
      }),
    ).toBeTruthy();
    // Let any effect that might fetch get its chance before counting.
    await Promise.resolve();
    expect(calls()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Your email")).toBeNull();
  });
});

describe("what the page says", () => {
  it("has one title and the four parts, in order, as second-level headings", () => {
    render(<Trust />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Today", "The basics", "The plan", "How to help"]);
  });

  it("explains each basic under its own heading", () => {
    render(<Trust />);
    const basics = within(
      screen.getByRole("region", { name: "The basics" }),
    ).getAllByRole("heading", { level: 3 });
    expect(basics.map((h) => h.textContent)).toEqual([
      "Fingerprint (hash)",
      "A chain of records",
      "Digital signature",
      "A public copy",
      "Independent checkers",
      "Votes written in groups",
    ]);
  });

  /*
   * The one claim this page must never make. Pulse votes are on no chain and
   * no ledger today (ADR-0039), so "Today" says so outright and "The basics"
   * frames itself as the ledger's design, not as what happened to your vote.
   */
  it("says plainly that votes are not on a public record yet", () => {
    render(<Trust />);
    const today = screen.getByRole("region", { name: "Today" });
    expect(today.textContent).toContain(
      "Your vote is not on a public record yet.",
    );
    expect(today.textContent).toContain(
      "Nobody outside pulse can check the count today.",
    );
    expect(
      screen.getByRole("region", { name: "The basics" }).textContent,
    ).toContain("The ledger is not built yet, and pulse votes are not on it.");
  });

  /*
   * A vote is filed under the browser's ballot cookie and nothing else,
   * signed in or not (apps/pulse/API.md, "The ballot cookie"), so signing in
   * must never be described as what stops a second vote.
   */
  it("ties the vote to the browser and does not claim signing in stops double votes", () => {
    render(<Trust />);
    const today = (
      screen.getByRole("region", { name: "Today" }).textContent ?? ""
    ).replace(/\s+/g, " ");
    expect(today).toContain(
      "Your vote is tied to this browser, whether or not you sign in.",
    );
    expect(today).toContain("It does not stop anyone voting twice");
    // The confirmed number (ADR-0040) is per address, never per person.
    expect(today).toContain("each email address counts once per question");
    expect(today).toContain("Two addresses still count as two.");
    expect(today.toLowerCase()).not.toMatch(
      /sign(ing)? in (ties|links|stops|prevents|proves)/,
    );
  });

  it("never says pulse votes are on a chain or ledger now", () => {
    render(<Trust />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const claim of [
      "your vote is on",
      "votes are on the",
      "is recorded on",
      "has been recorded on",
      "check the record yourself",
      "you can check the count now",
      "already on the ledger",
    ]) {
      expect(text).not.toContain(claim);
    }
  });

  it("states where the plan stands as status, not dates", () => {
    render(<Trust />);
    const plan = screen.getByRole("region", { name: "The plan" });
    const steps = within(plan).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent?.split(":")[0])).toEqual([
      "Done",
      "Done",
      "Next",
      "After that",
      "After that",
      "After that",
      "After that",
    ]);
    expect(plan.textContent).toContain("It does not exist yet.");
    expect(plan.textContent).not.toMatch(/\b20\d\d\b/);
  });
});

describe("how to help", () => {
  it("links to the rules, the charter, both checkers, the issues and the repository", () => {
    render(<Trust />);
    const help = screen.getByRole("region", { name: "How to help" });
    const hrefs = Object.fromEntries(
      within(help)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    );
    expect(hrefs).toEqual({
      "The rules": `${REPO}/tree/master/contracts`,
      "The charter": `${REPO}/blob/master/docs/charter.md`,
      "The Go checker": `${REPO}/tree/master/services/verifier`,
      "The TypeScript checker": `${REPO}/tree/master/tools/verifier-ts`,
      "Open issues": `${REPO}/issues`,
      "The whole project": REPO,
    });
  });

  it("offers a way back to the questions", () => {
    render(<Trust />);
    expect(
      screen
        .getByRole("link", { name: "Go to the questions" })
        .getAttribute("href"),
    ).toBe("/questions");
  });
});

describe("keyboard", () => {
  it("tabs through every link in reading order", async () => {
    const user = userEvent.setup();
    render(<Trust />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });
});
