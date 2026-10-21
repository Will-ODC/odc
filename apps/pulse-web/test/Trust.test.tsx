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
        name: "How votes count",
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

  it("keeps the page short enough to read at a glance", () => {
    render(<Trust />);
    const text = [
      ...screen.getByRole("article").querySelectorAll("h1, h2, h3, p, li"),
    ]
      .map((block) => block.textContent)
      .join(" ");
    const words = text.match(/\S+/g) ?? [];
    expect(words.length).toBeLessThanOrEqual(350);
  });

  it("defines the six basics in plain sentences", () => {
    render(<Trust />);
    const basics = screen.getByRole("region", { name: "The basics" });
    expect(within(basics).getAllByRole("listitem")).toHaveLength(6);
    for (const term of [
      "Hash",
      "Chain",
      "Digital signature",
      "Public copy",
      "Independent checkers",
      "Votes in groups",
    ]) {
      expect(basics.textContent).toContain(term);
    }
    expect(basics.textContent).toMatch(/ledger.*record.*only allows additions/);
    expect(basics.textContent).toMatch(/not built yet/);
  });

  it("states the present limits on checking and privacy", () => {
    render(<Trust />);
    const today =
      screen.getByRole("region", { name: "Today" }).textContent ?? "";
    expect(today).toMatch(/No public vote record exists yet/);
    expect(today).toMatch(/Only Pulse.s operators can check the count today/);
    expect(today).toMatch(
      /Email-confirmed votes store a code instead of your email/,
    );
    expect(today).toMatch(
      /operator can link it to you with the database and secret key/,
    );
  });

  it("explains browser votes and the separate email count without promising unique people", () => {
    render(<Trust />);
    const today =
      screen.getByRole("region", { name: "Today" }).textContent ?? "";
    expect(today).toMatch(/Change it until the question closes/);
    expect(today).toMatch(/new answer replaces the old one/);
    expect(today).toMatch(/browser.s cookie/);
    expect(today).toMatch(
      /another browser, clearing cookies or signing out.*add votes to the full total/,
    );
    expect(today).toMatch(
      /Email-confirmed votes count once per account per question/,
    );
    expect(today).toMatch(/most recent answer counts/);
    expect(today).toMatch(
      /Vote signed in, or sign in on that browser before the question closes/,
    );
    expect(today).toMatch(/Two emails count twice/);
    expect(today).toMatch(/does not prove each voter is a different person/);
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
      "Next",
      "Later",
    ]);
    expect(steps[0]?.textContent).toMatch(
      /Drafted rules and two independent checkers/,
    );
    expect(steps[1]?.textContent).toMatch(/fresh security review/);
    expect(steps[2]?.textContent).toMatch(
      /Build the ledger and connect Pulse through its public API/,
    );
    expect(steps[2]?.textContent).toMatch(
      /cannot prove every vote was entered honestly/,
    );
    expect(steps[2]?.textContent).toMatch(
      /Anyone will be able to recount from a public copy/,
    );
    expect(plan.textContent).not.toMatch(/\b20\d\d\b/);
  });
});

describe("how to help", () => {
  it("links to the rules, project and issues", () => {
    render(<Trust />);
    const help = screen.getByRole("region", { name: "How to help" });
    const hrefs = Object.fromEntries(
      within(help)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    );
    expect(hrefs).toEqual({
      Rules: `${REPO}/tree/master/contracts`,
      Project: REPO,
      Issues: `${REPO}/issues`,
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
