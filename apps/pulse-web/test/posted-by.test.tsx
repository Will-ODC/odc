// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TopBanner } from "../src/components/TopBanner.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, stubApi } from "./stub-api.js";

/*
 * Who posted a poll is shown wherever the poll is (ADR-0037): the question at
 * the top of the conversation, and the vote card that covers it on a phone.
 */
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
  /*
   * Once, on the card, while the card is open: the page heading is merged
   * out of sight then, so the byline is not drawn twice (operator
   * walkthrough, 2026-10-21). With the card closed it is at the top.
   */
  it("says anonymously, once, on the open card", async () => {
    const main = await open({ attribution: { kind: "anonymous" } });
    expect(main.getAllByText("Posted anonymously")).toHaveLength(1);
    expect(
      within(main.getByRole("region")).getByText("Posted anonymously"),
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

  it("says it at the top once the card is closed", async () => {
    const main = await open({ attribution: { kind: "anonymous" } });
    await userEvent.click(
      within(main.getByRole("region")).getByRole("button", { name: "Close" }),
    );
    expect(main.getAllByText("Posted anonymously")).toHaveLength(1);
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

  it("is left out where the bar is not given one", () => {
    render(<TopBanner />);
    expect(screen.queryByRole("link", { name: "Post a question" })).toBeNull();
  });
});
