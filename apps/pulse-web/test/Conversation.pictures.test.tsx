// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Conversation } from "../src/screens/Conversation.js";
import { answer, castYes, main } from "./conversation-fixtures.js";
import { poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
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

  it.each(["category", "tile"] as const)(
    "renders a small tile for a %s picture",
    async (kind) => {
      const p = poll({
        image: kind === "category" ? { kind, ...picture } : { kind },
        community: { id: "parks", label: "Parks" },
      });
      render(
        <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
      );
      const heading = await main().findByRole("heading", { level: 1 });
      const tile = main().getByRole("img", {
        name: kind === "category" ? picture.alt : "Parks",
      });
      expect(heading.nextElementSibling).toBe(tile);
      expect(tile.classList.contains("question-picture--tile")).toBe(true);
      if (kind === "tile") expect(tile.textContent).toBe("P");
    },
  );

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
    render(
      <Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />,
    );
    const heading = await main().findByRole("heading", { level: 1 });
    expect(heading.nextElementSibling).toBe(main().getByText(/The first line/));
    expect(main().queryByRole("img")).toBeNull();
  });
});
