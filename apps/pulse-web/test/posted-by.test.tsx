// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TopBanner } from "../src/components/TopBanner.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, stubApi } from "./stub-api.js";

// The byline stays beside the main question when the popout opens or closes.
afterEach(cleanup);

async function open(attribution?: Parameters<typeof poll>[0]) {
  render(
    <Conversation
      api={stubApi({ poll: () => Promise.resolve(poll(attribution)) })}
      pollId="ads-free"
    />,
  );
  const main = within(screen.getByRole("main"));
  await main.findByRole("heading", { level: 1 });
  // The card opens with the question (#401), so there is no Vote to press.
  await main.findByRole("region");
  return main;
}

describe("who posted it", () => {
  it("says anonymously once beside the main question", async () => {
    const main = await open({ attribution: { kind: "anonymous" } });
    expect(main.getAllByText("Posted anonymously")).toHaveLength(1);
    expect(
      within(main.getByRole("heading", { level: 1 }).parentElement!).getByText(
        "Posted anonymously",
      ),
    ).toBeTruthy();
  });

  it("shows a chosen name as plain text", async () => {
    const main = await open({
      attribution: { kind: "named", name: "<b>Ada</b>" },
    });
    expect(main.getAllByText("Posted by <b>Ada</b>")).toHaveLength(1);
    // Rendered as text: no element was made from the name.
    expect(
      [...document.querySelectorAll("main b")].some(
        (node) => node.textContent === "Ada",
      ),
    ).toBe(false);
  });

  it("keeps the same byline at the top when the card closes", async () => {
    const main = await open({ attribution: { kind: "anonymous" } });
    const byline = main.getByText("Posted anonymously");
    await userEvent.click(
      within(main.getByRole("region")).getByRole("button", { name: "Close" }),
    );
    expect(main.getAllByText("Posted anonymously")).toHaveLength(1);
    expect(main.getByText("Posted anonymously")).toBe(byline);
    expect(main.queryByRole("region")).toBeNull();
  });

  it("says nothing for a poll from before posting existed", async () => {
    const main = await open();
    expect(main.queryByText(/^Posted /)).toBeNull();
  });
});

describe("the way to post", () => {
  it("is in the bar across the top of a conversation", async () => {
    render(<Conversation api={stubApi()} pollId="ads-free" />);
    const link = await screen.findByRole("link", { name: "Post a question" });
    expect(link.getAttribute("href")).toBe("/new");
  });

  it("is available consistently by default", () => {
    render(<TopBanner />);
    expect(
      screen
        .getByRole("link", { name: "Post a question" })
        .getAttribute("href"),
    ).toBe("/new");
  });
});
