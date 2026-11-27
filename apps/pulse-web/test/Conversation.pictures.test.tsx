// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, results, stubApi } from "./stub-api.js";
import { main, answer, castYes } from "./conversation-fixtures.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

describe("question pictures and context (#296)", () => {
  const picture = {
    displayUrl: "/api/poll-images/example/display.webp",
    thumbUrl: "/api/poll-images/example/thumb.webp",
    width: 1200,
    height: 800,
    alt: "Two people talking beside a park bench",
  };
  const context = "The first line.\n<strong>The second line.</strong>";

  it.each([true, false])(
    "puts the upload and literal context after the question (open: %s)",
    async (open) => {
      const p = poll({ open, image: { kind: "upload", ...picture }, context });
      render(
        <Conversation
          api={stubApi({
            poll: async () => p,
            results: async () => results(),
            cast: castYes,
          })}
          pollId={p.id}
        />,
      );
      const heading = await main().findByRole("heading", { level: 1 });
      const image = main().getByRole("img", { name: picture.alt });
      expect(image.getAttribute("src")).toBe(picture.displayUrl);
      expect(heading.nextElementSibling).toBe(image);
      const body = main().getByText(/The first line/);
      expect(image.nextElementSibling).toBe(body);
      expect(body.textContent).toBe(context);
      expect(body.childElementCount).toBe(0);

      if (open) {
        await answer();
      } else {
        await userEvent.click(
          main().getByRole("button", { name: "See results" }),
        );
        expect(
          await main().findByText("Nobody answered this one."),
        ).toBeTruthy();
      }
    },
  );

  it("renders the category picture at the small default size", async () => {
    const p = poll({ image: { kind: "category", ...picture } });
    render(
      <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
    );
    const heading = await main().findByRole("heading", { level: 1 });
    const image = main().getByRole("img", { name: picture.alt });
    expect(heading.nextElementSibling).toBe(image);
    expect(image.classList.contains("item-picture--tile")).toBe(true);
  });

  it("puts context directly after the question for a tile picture", async () => {
    const p = poll({
      image: { kind: "tile" },
      community: { id: "parks", label: "Parks" },
      context,
    });
    render(
      <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
    );
    const heading = await main().findByRole("heading", { level: 1 });
    expect(main().queryByRole("img", { name: "Parks" })).toBeNull();
    expect(heading.nextElementSibling).toBe(main().getByText(/The first line/));
  });

  it.each(["upload", "category"] as const)(
    "removes the %s picture on error while keeping context and voting",
    async (kind) => {
      const p = poll({ image: { kind, ...picture }, context });
      render(
        <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
      );
      const heading = await main().findByRole("heading", { level: 1 });
      fireEvent.error(main().getByRole("img", { name: picture.alt }));
      expect(main().queryByRole("img")).toBeNull();
      expect(heading.nextElementSibling).toBe(
        main().getByText(/The first line/),
      );
      expect(main().getByRole("button", { name: "Submit" })).toBeTruthy();
    },
  );

  it("puts context directly after the question when the picture field is absent", async () => {
    const p = poll({ context });
    delete p.image;
    render(
      <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
    );
    const heading = await main().findByRole("heading", { level: 1 });
    expect(heading.nextElementSibling).toBe(main().getByText(/The first line/));
    expect(main().queryByRole("img")).toBeNull();
  });
});
