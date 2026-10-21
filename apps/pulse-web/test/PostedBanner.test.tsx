// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostedBanner } from "../src/components/PostedBanner.js";

afterEach(cleanup);

const URL_ = "https://pulse.test/?poll=garden";

function useClipboard(clipboard: unknown) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

describe("the line over a question just posted", () => {
  it("copies the address and says so politely", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    useClipboard({ writeText });
    render(<PostedBanner url={URL_} onDismiss={() => {}} />);
    expect(screen.getByText(/Your question is live/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect((await screen.findByText("Copied")).getAttribute("role")).toBe(
      "status",
    );
  });

  it("says Copied afresh on a second copy", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    useClipboard({ writeText });
    render(<PostedBanner url={URL_} onDismiss={() => {}} />);
    const status = screen.getByRole("status");
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await act(async () => finish());
    expect(status.textContent).toBe("Copied");
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    // Emptied while copying, so "Copied" is new text to read out again.
    expect(status.textContent).toBe("");
    await act(async () => finish());
    expect(status.textContent).toBe("Copied");
  });

  it("selects the address in a read-only field when there is no clipboard", async () => {
    const user = userEvent.setup();
    useClipboard(undefined);
    render(<PostedBanner url={URL_} onDismiss={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Link to your question",
    });
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(URL_);
    await waitFor(() => {
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(URL_.length);
    });
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("falls back to the field when the clipboard refuses", async () => {
    const user = userEvent.setup();
    useClipboard({ writeText: () => Promise.reject(new Error("denied")) });
    render(<PostedBanner url={URL_} onDismiss={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(
      await screen.findByRole("textbox", { name: "Link to your question" }),
    ).toBeTruthy();
  });

  it("can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<PostedBanner url={URL_} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
