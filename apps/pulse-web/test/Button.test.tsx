// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "../src/components/Button.js";
import { SiteBanner } from "../src/components/SiteBanner.js";

afterEach(cleanup);

it("draws the small secondary size as one more modifier class (#569)", () => {
  render(
    <Button variant="secondary" size="small" className="x" type="button">
      Try again
    </Button>,
  );
  expect(screen.getByRole("button", { name: "Try again" }).className).toBe(
    "btn btn--secondary btn--small x",
  );
});

it("adds no size class at the default size", () => {
  render(
    <Button variant="secondary" type="button">
      Close
    </Button>,
  );
  expect(screen.getByRole("button", { name: "Close" }).className).toBe(
    "btn btn--secondary",
  );
});

it("keeps a disabled small button disabled and unpressable", async () => {
  const onClick = vi.fn();
  render(
    <Button variant="secondary" size="small" disabled onClick={onClick}>
      Loading more…
    </Button>,
  );
  const button = screen.getByRole("button", { name: "Loading more…" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it("draws the account menu's Try again as the small secondary Button", async () => {
  const onRetry = vi.fn();
  const user = userEvent.setup();
  render(
    <SiteBanner
      session={{ status: "signedOut" }}
      progress={{ status: "idle" }}
      holdsVotes
      voteRead={{
        status: "error",
        message: "We couldn't load your votes.",
        onRetry,
      }}
      onSignOut={() => {}}
      onCancel={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Account" }));
  const retry = screen.getByRole("button", { name: "Try again" });
  expect(retry.className).toBe("btn btn--secondary btn--small");
  retry.focus();
  await user.keyboard("{Enter}");
  expect(onRetry).toHaveBeenCalledOnce();
});
