// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
  it("says anonymously, at the top and on the card", async () => {
    const main = await open({ attribution: { kind: "anonymous" } });
    expect(main.getAllByText("Posted anonymously")).toHaveLength(2);
    expect(
      within(main.getByRole("region")).getByText("Posted anonymously"),
    ).toBeTruthy();
  });

  it("shows a chosen name as plain text", async () => {
    const main = await open({
      attribution: { kind: "named", name: "<b>Ada</b>" },
    });
    expect(main.getAllByText("Posted by <b>Ada</b>")).toHaveLength(2);
    // Rendered as text: no element was made from the name.
    expect(
      [...document.querySelectorAll("main b")].some(
        (node) => node.textContent === "Ada",
      ),
    ).toBe(false);
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
