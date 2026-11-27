// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import { ContributionsError } from "../src/api/contributions.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
  switchableMe,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("links the organizer by profile id while keeping the contribution byline", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client({
        detail: async () => ({
          contribution: fixture({
            organizerName: "Contribution byline",
            organizerProfile: {
              publicId: "profile-id",
              displayName: "Current profile name",
            },
          }),
          canManage: false,
        }),
      })}
    />,
  );
  const link = await screen.findByRole("link", {
    name: "Contribution byline",
  });
  expect(link.getAttribute("href")).toBe("/u/profile-id");
  expect(screen.queryByText("Current profile name")).toBeNull();
});

it("does not offer help or pledges on a closed contribution", async () => {
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "helper",
          email: "helper@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({
          contribution: fixture({ status: "completed" }),
          canManage: false,
        }),
      })}
    />,
  );
  expect(
    await screen.findByText(
      "This contribution is closed to new offers of help and pledges.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Public name")).toBeNull();
});

it("lists each private message under a line with its date", async () => {
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        messages: async () => [
          {
            id: "message",
            message: "I can bring wood.",
            createdAt: "2026-11-15T12:00:00.000Z",
          },
        ],
      })}
    />,
  );
  await userEvent.click(
    await screen.findByText("Private messages", { exact: true }),
  );
  const message = await screen.findByText("I can bring wood.");
  const entry = message.closest("li");
  const meta = entry?.querySelector(".contribution-meta");
  expect(meta?.textContent).toBe("Nov 15, 2026");
  expect(entry?.firstElementChild).toBe(meta);
});

it("moves focus to the title of a contribution just published", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client()}
      focusHeading
    />,
  );
  const title = await screen.findByRole("heading", {
    level: 1,
    name: "Make the park accessible",
  });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it("leaves focus alone on a contribution opened any other way", async () => {
  render(<ContributionDetail api={stubApi()} id="park" client={client()} />);
  await screen.findByRole("heading", { level: 1 });
  expect(document.activeElement).toBe(document.body);
});

// jsdom has no scrollIntoView; record which element the page asks to show.
function stubScroll() {
  const scrolled: Element[] = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element) {
      scrolled.push(this);
    },
  });
  return {
    scrolled,
    restore: () => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    },
  };
}

const organizerApi = () =>
  stubApi({
    me: async () => ({
      id: "owner",
      email: "owner@example.test",
      community: null,
    }),
  });

it("goes to the updates section named in the link once the page loads, with focus on its heading", async () => {
  globalThis.history.replaceState(null, "", "/contributions/park#updates");
  const scroll = stubScroll();
  try {
    render(
      <ContributionDetail
        api={organizerApi()}
        id="park"
        client={client({
          detail: async () => ({ contribution: fixture(), canManage: true }),
        })}
        focusHeading
      />,
    );
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Progress and evidence",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(scroll.scrolled).toEqual([heading]);
    // The published-page title focus does not take it back afterwards.
    await act(async () => {});
    expect(document.activeElement).toBe(heading);
  } finally {
    scroll.restore();
    globalThis.history.replaceState(null, "", "/");
  }
});

it("goes to the organizer inbox named in the link, after the session says who is reading", async () => {
  globalThis.history.replaceState(null, "", "/contributions/park#messages");
  const scroll = stubScroll();
  let signIn!: () => void;
  const signedIn = new Promise<void>((resolve) => (signIn = resolve));
  try {
    render(
      <ContributionDetail
        api={stubApi({
          me: async () => {
            await signedIn;
            return {
              id: "owner",
              email: "owner@example.test",
              community: null,
            };
          },
        })}
        id="park"
        client={client({
          detail: async () => ({ contribution: fixture(), canManage: true }),
        })}
      />,
    );
    // Before the session answers, the page shows the public message form:
    // focus waits rather than landing on a control about to be replaced.
    await screen.findByText("Message the organizer");
    expect(document.activeElement).toBe(document.body);
    signIn();
    const inbox = await screen.findByText("Private messages");
    await waitFor(() => expect(document.activeElement).toBe(inbox));
    expect(screen.queryByText("Message the organizer")).toBeNull();
    expect(scroll.scrolled).toEqual([inbox]);
    // The link opens what it names (#610): the inbox is read and shown.
    expect(inbox.closest("details")?.open).toBe(true);
    expect(await screen.findByText("No messages yet.")).toBeTruthy();
  } finally {
    scroll.restore();
    globalThis.history.replaceState(null, "", "/");
  }
});

it("ignores a link fragment that names no section", async () => {
  globalThis.history.replaceState(null, "", "/contributions/park#elsewhere");
  try {
    render(<ContributionDetail api={stubApi()} id="park" client={client()} />);
    await screen.findByRole("heading", { level: 1 });
    expect(document.activeElement).toBe(document.body);
  } finally {
    globalThis.history.replaceState(null, "", "/");
  }
});

it("closed contributions can still be contacted and display existing price and fund details", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client({
        detail: async () => ({
          canManage: false,
          contribution: fixture({
            status: "completed",
            commercial: {
              currency: "CAD",
              regularPriceMinor: 10000,
              offeredPriceMinor: 7500,
              referenceUrl: "https://example.com/price",
              terms: "Collect from the organizer.",
            },
            fund: { name: "Garden fund", percentage: 10 },
          }),
        }),
      })}
    />,
  );
  expect(await screen.findByText("25% advertised savings")).toBeTruthy();
  expect(screen.getByText(/organizer pledges 10%/)).toBeTruthy();
  expect(
    screen.getByText("Message the organizer").closest("details")?.open,
  ).toBe(false);
});

it("does not offer retry when a contribution is not found", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="missing"
      client={client({
        detail: async () => {
          throw new ContributionsError(
            404,
            "This contribution could not be found.",
          );
        },
      })}
    />,
  );
  expect(
    await screen.findByText("This contribution could not be found."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.getByRole("link", { name: "← Contributions" })).toBeTruthy();
});

it("says when a background reload fails and offers to try again without hiding the page", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe(null);
  let failing = false;
  const detail = vi.fn(async () => {
    if (failing) throw new ContributionsError(503, "Could not load.");
    return { contribution: fixture(), canManage: state.who === "owner" };
  });
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ detail })}
    />,
  );
  const title = await screen.findByRole("heading", { level: 1 });
  failing = true;
  state.who = "owner";
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findByText(/This page could not be brought up to date/),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 })).toBe(title);
  failing = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Post an update")).toBeTruthy();
  // The banner and its button are gone; focus goes to the title, not the page.
  expect(document.activeElement).toBe(title);
  expect(
    screen.queryByText(/This page could not be brought up to date/),
  ).toBeNull();
  expect(screen.getByRole("heading", { level: 1 })).toBe(title);
});
