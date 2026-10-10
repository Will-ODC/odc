// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DialogProgress } from "../src/components/DecisionDialog.js";
import { DecisionDialog } from "../src/components/DecisionDialog.js";
import type { Access } from "../src/flow/decision.js";
import { defineDecision } from "../src/flow/decision.js";
import { installDialog } from "./dialog-polyfill.js";

beforeAll(installDialog);
afterEach(cleanup);

const DECISION = defineDecision({
  id: "d1",
  question: "Which colour for the new benches?",
  choices: [
    { id: "green", label: "Green" },
    { id: "blue", label: "Blue" },
  ],
});

/**
 * The dialog is controlled, so a test needs a parent: this one opens it from
 * a button, as a real screen would, and reports what the dialog asks for.
 */
function Harness({
  onClose,
  onSubmit,
  access = "answerable",
  progress = { status: "idle" },
}: {
  onClose: () => void;
  onSubmit: (id: string) => void;
  access?: Access;
  progress?: DialogProgress;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      <button type="button">Somewhere else</button>
      <DecisionDialog
        decision={DECISION}
        open={open}
        access={access}
        picked={picked}
        progress={progress}
        onPick={setPicked}
        onSubmit={onSubmit}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        confirmation={<p>Done.</p>}
        doneLabel="Finish"
      />
    </>
  );
}

describe("the decision popup", () => {
  it("is a dialog named by its question", async () => {
    render(<Harness onClose={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(
      screen.getByRole("dialog", { name: "Which colour for the new benches?" }),
    ).toBeTruthy();
  });

  it("submits the id of the choice picked, not its label", async () => {
    const onSubmit = vi.fn();
    render(<Harness onClose={vi.fn()} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.click(screen.getByRole("radio", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("blue");
  });

  /*
   * Closing from code fires the dialog's own `close` event as well. Reported
   * as a second close, a parent would run its closing twice.
   */
  it("reports one close when Close is pressed", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} onSubmit={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports one close on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} onSubmit={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands focus back to whatever opened it", async () => {
    render(<Harness onClose={vi.fn()} onSubmit={vi.fn()} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    expect(document.activeElement).not.toBe(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("shows the confirmation slot and its button once sent", async () => {
    render(
      <Harness
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        progress={{ status: "sent" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("status").textContent).toBe("Done.");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Finish" }),
    );
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("switches the choices off while an answer is sending", async () => {
    render(
      <Harness
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        progress={{ status: "sending" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.matches(":disabled")).toBe(true);
    }
    expect(
      (screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
