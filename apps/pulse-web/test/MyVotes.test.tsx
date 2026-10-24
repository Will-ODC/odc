// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);

it("shows server-backed answers and loads another page", async () => {
  const user = userEvent.setup();
  const myVotes = vi.fn(async (cursor?: string) =>
    cursor
      ? {
          votes: [
            {
              pollId: "p2",
              question: "Where next?",
              choices: ["Park"],
              castAt: "2026-10-20T11:00:00.000Z",
              open: false,
            },
          ],
          nextCursor: null,
        }
      : {
          votes: [
            {
              pollId: "p1",
              question: "Keep it free?",
              choices: ["Yes"],
              castAt: "2026-10-20T12:00:00.000Z",
              open: true,
            },
          ],
          nextCursor: "next",
        },
  );
  render(<App api={stubApi({ myVotes })} route={{ kind: "myVotes" }} />);
  expect(await screen.findByText("Your answer: Yes")).toBeTruthy();
  expect(screen.getByText("Open · You can change your answer")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Your answer: Park")).toBeTruthy();
  expect(myVotes).toHaveBeenCalledWith("next");
  expect(screen.getByText("Closed · View results")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Where next?" }).getAttribute("href"),
  ).toBe("/?poll=p2");
});

it("clears visible answers after forgetting this browser's votes", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn(async () => {});
  render(
    <App
      api={stubApi({
        myVotes: async () => ({
          votes: [
            {
              pollId: "p1",
              question: "Keep it free?",
              choices: ["Yes"],
              castAt: "2026-10-20T12:00:00.000Z",
              open: true,
            },
          ],
          nextCursor: null,
        }),
        signOut,
      })}
      route={{ kind: "myVotes" }}
    />,
  );
  await screen.findByText("Your answer: Yes");
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(
    screen.getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(screen.getByRole("button", { name: "Forget them" }));
  await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  expect(
    await screen.findByText(/No votes saved in this browser yet/),
  ).toBeTruthy();
  expect(screen.queryByText("Your answer: Yes")).toBeNull();
});
