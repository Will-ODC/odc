// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import {
  SAMPLE_COMMENTS,
  commentsWithStance,
  randomSample,
  visibleComments,
} from "../src/flow/comment-visibility.js";
import { CommentVisibilityPreview } from "../src/screens/CommentVisibilityPreview.js";

afterEach(cleanup);

it("keeps mixed, uncertain and moderated examples out of stance groups", () => {
  expect(
    commentsWithStance(SAMPLE_COMMENTS, "Garden", "support").map((c) => c.id),
  ).toEqual(["1", "5", "7"]);
  expect(
    commentsWithStance(SAMPLE_COMMENTS, "Garden", "oppose").map((c) => c.id),
  ).toEqual(["2", "3"]);
  expect(visibleComments(SAMPLE_COMMENTS).map((c) => c.id)).not.toContain("9");
  expect(commentsWithStance(SAMPLE_COMMENTS, "Playground", "oppose")).toEqual(
    [],
  );
});

it("offers three equally scoped views and the complete chronological baseline", async () => {
  render(<CommentVisibilityPreview />);
  const main = screen.getByRole("main");
  expect(within(main).getByText(/does not read real comments/)).toBeTruthy();
  const views = main.querySelector(".comment-preview__views")!;
  expect(views.querySelectorAll(":scope > section")).toHaveLength(3);
  expect(
    within(views as HTMLElement).getByRole("heading", {
      name: "Agreeing with Garden",
    }),
  ).toBeTruthy();
  expect(
    within(views as HTMLElement).getByRole("heading", {
      name: "Opposing Garden",
    }),
  ).toBeTruthy();
  expect(
    within(views as HTMLElement).getByRole("heading", {
      name: "Random sample",
    }),
  ).toBeTruthy();
  const baseline = main.querySelector(".comment-preview__baseline")!;
  expect(baseline.querySelectorAll("li")).toHaveLength(8);
  expect(baseline.textContent).not.toContain(
    "This sample is excluded by moderation",
  );

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Reference viewpoint" }),
    "Playground",
  );
  expect(
    screen.getByRole("heading", { name: "Opposing Playground" }),
  ).toBeTruthy();
  expect(
    screen.getByText("No sample comments explicitly oppose Playground."),
  ).toBeTruthy();
  expect(baseline.querySelectorAll("li")).toHaveLength(8);
});

it("shuffles only the sample and never changes the chronological thread", async () => {
  render(<CommentVisibilityPreview />);
  const baseline = screen
    .getByRole("heading", { name: "Original chronological thread" })
    .closest("section")!;
  const original = baseline.textContent;
  const sampleSection = screen
    .getByRole("heading", { name: "Random sample" })
    .closest("section")!;
  expect(sampleSection.querySelectorAll("li")).toHaveLength(3);
  const button = screen.getByRole("button", { name: "Shuffle sample" });
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(sampleSection.querySelectorAll("li")).toHaveLength(3);
  expect(baseline.textContent).toBe(original);
});

it("never samples a hidden comment", () => {
  for (let i = 0; i < 10; i++) {
    expect(randomSample(SAMPLE_COMMENTS).map((one) => one.id)).not.toContain(
      "9",
    );
  }
});
