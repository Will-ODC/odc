import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { CAST_RESULTS, counted } from "./stub-api.js";

export const main = () => within(screen.getByRole("main"));
/** The saved-answer line, whose labels are in bold (#478). */
export const said = (text: string) => (_: string, node: Element | null) =>
  node?.tagName === "SPAN" && node.textContent === text;
export const castYes = async () => counted(1, CAST_RESULTS);

export function card() {
  return main().getByRole("region");
}
export function openCard() {
  // Cards open by default (#401); fail loudly rather than click Vote.
  expect(main().queryByRole("region")).not.toBeNull();
}
export async function answer(label = "Yes") {
  const user = userEvent.setup();
  openCard();
  await user.click(within(card()).getByRole("radio", { name: label }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  return user;
}
export const banner = () => within(screen.getAllByRole("banner")[0]!);
/** The account's controls sit behind one button (walkthrough, 2026-10-21). */
export async function openAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await banner().findByRole("button", { name: "Account" }));
}

export const rail = () =>
  within(screen.getByRole("navigation", { name: "My votes" }));
export const voteLinks = () => within(rail().getByRole("list"));
export const fromServer = {
  pollId: "parks",
  question: "More parks?",
  choices: ["Yes"],
  ballot: [1],
  castAt: "2026-11-01T00:00:00.000Z",
  closesAt: null,
  open: true,
};

/** Moves fake time on by exactly `ms`, settling what that lets finish. */
export const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
