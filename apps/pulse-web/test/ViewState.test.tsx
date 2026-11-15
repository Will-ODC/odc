// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ViewState } from "../src/components/ViewState.js";
import type { ViewData } from "../src/hooks/view-data.js";

afterEach(cleanup);
it("offers a retry only for errors and calls its handler by keyboard", async () => {
  const onRetry = vi.fn();
  const view = (data: ViewData<string>) => (
    <ViewState data={data} onRetry={onRetry}>
      {(value) => value}
    </ViewState>
  );
  const { rerender } = render(
    view({ status: "error", message: "Could not load." }),
  );
  const retry = screen.getByRole("button", { name: "Try again" });
  expect(retry.className).toBe("btn btn--secondary btn--small");
  expect(within(screen.getByRole("status")).queryByRole("button")).toBeNull();
  await userEvent.tab();
  expect(document.activeElement).toBe(retry);
  await userEvent.keyboard("{Enter}");
  expect(onRetry).toHaveBeenCalledOnce();
  for (const data of [
    { status: "loading" },
    { status: "empty", message: "Nothing here." },
    { status: "ready", value: "Loaded" },
  ] satisfies ViewData<string>[]) {
    rerender(view(data));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  }
  rerender(
    <ViewState data={{ status: "error", message: "Could not load." }}>
      {() => null}
    </ViewState>,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});
