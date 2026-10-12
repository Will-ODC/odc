// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { VoteCard } from "../src/components/VoteCard.js";
import type { VoteCardProps } from "../src/components/VoteCard.js";
import { results } from "./stub-api.js";

// jsdom has no CSS.escape; user-event uses it for native radio arrow navigation.
beforeAll(() =>
  vi.stubGlobal("CSS", {
    escape: (value: string) =>
      value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  }),
);
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);
const choices = [
  { index: 7, label: "Park", detail: "Next: where to build it?" },
  { index: 2, label: "Library" },
  { index: 9, label: "Rink" },
];
const base: VoteCardProps = {
  question: "What should we build?",
  why: "Closes Wednesday · you can change your answer until then.",
  method: "single",
  choices,
  picked: [],
  status: { kind: "answerable" },
  privacyNote: "Your answer is private.",
  collapsed: false,
  onPick: vi.fn(),
  onSubmit: vi.fn(),
  onCollapse: vi.fn(),
  onClose: vi.fn(),
};
function Harness(over: Partial<VoteCardProps>) {
  const [picked, setPicked] = useState<number[]>([...(over.picked ?? [])]);
  const [collapsed, setCollapsed] = useState(over.collapsed ?? false);
  return (
    <VoteCard
      {...base}
      {...over}
      picked={picked}
      collapsed={collapsed}
      onPick={setPicked}
      onCollapse={setCollapsed}
    />
  );
}
const button = (name: string) => screen.getByRole("button", { name });
const checked = (role: "radio" | "checkbox") =>
  screen.getAllByRole(role).filter((one) => (one as HTMLInputElement).checked);

describe("picking and submitting", () => {
  it("renders the question, explanation, detail and privacy note", () => {
    render(<VoteCard {...base} />);
    expect(screen.getByRole("region", { name: base.question })).toBeTruthy();
    expect(screen.getByText(base.why)).toBeTruthy();
    expect(screen.getByText(choices[0]!.detail!)).toBeTruthy();
    expect(screen.getByText(base.privacyNote)).toBeTruthy();
    expect((button("Submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("single-choice picking replaces the previous pick and submits its index", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={submit} />);
    await user.click(screen.getByRole("radio", { name: "Park" }));
    await user.click(screen.getByRole("radio", { name: "Library" }));
    expect(checked("radio")).toEqual([
      screen.getByRole("radio", { name: "Library" }),
    ]);
    expect(submit).not.toHaveBeenCalled();
    await user.click(button("Submit"));
    expect(submit).toHaveBeenCalledExactlyOnceWith([2]);
  });
  it("approval picking toggles independently and submits every index", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<Harness method="approval" onSubmit={submit} />);
    for (const name of ["Park", "Library", "Park", "Rink"])
      await user.click(screen.getByRole("checkbox", { name }));
    expect(checked("checkbox")).toHaveLength(2);
    await user.click(button("Submit"));
    expect(submit).toHaveBeenCalledExactlyOnceWith([2, 9]);
  });
  it("can deselect the last approval and then cannot submit", async () => {
    const user = userEvent.setup();
    render(<Harness method="approval" picked={[7]} />);
    await user.click(screen.getByRole("checkbox", { name: "Park" }));
    expect((button("Submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it.each([[100], [7, 7], [7, 2], [-1], [2.5]])(
    "refuses an invalid single ballot %j",
    async (...picked) => {
      const submit = vi.fn();
      render(<VoteCard {...base} picked={picked} onSubmit={submit} />);
      await userEvent.click(button("Submit"));
      expect(submit).not.toHaveBeenCalled();
    },
  );
});

describe("keyboard", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "number %i selects its numbered row, not an index",
    async (n) => {
      const submit = vi.fn();
      const user = userEvent.setup();
      const rows = Array.from({ length: 9 }, (_, at) => ({
        index: 20 - at,
        label: `Answer ${at + 1}`,
      }));
      render(<Harness choices={rows} onSubmit={submit} />);
      screen.getByRole("radio", { name: "Answer 1" }).focus();
      await user.keyboard(String(n));
      expect(
        (screen.getByRole("radio", { name: `Answer ${n}` }) as HTMLInputElement)
          .checked,
      ).toBe(true);
      await user.tab();
      await user.keyboard("{Enter}");
      expect(submit).toHaveBeenCalledExactlyOnceWith([21 - n]);
    },
  );
  it("opens choices with Tab, picks with Space/arrows and submits with Enter", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={submit} />);
    await user.tab();
    expect(document.activeElement).toBe(button("Close"));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Park" }),
    );
    await user.keyboard(" {ArrowRight}");
    expect(
      (screen.getByRole("radio", { name: "Library" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(button("Submit"));
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledExactlyOnceWith([2]);
  });
  it("approval shortcuts toggle without casting and checkbox Space works", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<Harness method="approval" onSubmit={submit} />);
    screen.getByRole("checkbox", { name: "Park" }).focus();
    await user.keyboard("12");
    expect(checked("checkbox")).toHaveLength(2);
    await user.keyboard("1 ");
    expect(checked("checkbox")).toHaveLength(2);
    expect(submit).not.toHaveBeenCalled();
  });
  it("ignores shortcuts outside the card and while typing in Something else", async () => {
    const pick = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Outside" />
        <VoteCard
          {...base}
          onPick={pick}
          other={<input aria-label="Something else" />}
        />
      </>,
    );
    await user.type(screen.getByRole("textbox", { name: "Outside" }), "1");
    await user.type(
      screen.getByRole("textbox", { name: "Something else" }),
      "2",
    );
    button("Close").focus();
    await user.keyboard("0{Control>}1{/Control}8");
    expect(pick).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it.each(["unconfirmed", "closed", "sending"] as const)(
    "%s refuses both pointer and numbered picks",
    async (kind) => {
      const pick = vi.fn(),
        submit = vi.fn();
      const user = userEvent.setup();
      render(
        <VoteCard
          {...base}
          picked={[7]}
          status={{ kind }}
          onPick={pick}
          onSubmit={submit}
        />,
      );
      await user.click(screen.getByRole("radio", { name: "Library" }));
      button("Close").focus();
      await user.keyboard("2");
      expect(pick).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      if (kind === "sending") {
        expect((button("Sending…") as HTMLButtonElement).disabled).toBe(true);
        await user.dblClick(button("Sending…"));
        expect(submit).not.toHaveBeenCalled();
      } else {
        expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
        expect(screen.getByRole("status").textContent).toContain(
          kind === "closed" ? "This one has closed." : "Only confirmed members",
        );
      }
    },
  );
  it("a failed send preserves picks and offers a retry with the same ballot", async () => {
    const submit = vi.fn();
    render(
      <VoteCard
        {...base}
        picked={[2]}
        status={{ kind: "failed", message: "Try your connection again." }}
        onSubmit={submit}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Try your connection again.",
    );
    await userEvent.click(button("Try again"));
    expect(submit).toHaveBeenCalledExactlyOnceWith([2]);
  });
  it("shows results in place, marks all picks, and offers change, next and one close", async () => {
    const change = vi.fn(),
      next = vi.fn(),
      close = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        method="approval"
        picked={[7, 2]}
        status={{
          kind: "answered",
          changed: true,
          results: results({
            method: "approval",
            voters: 1,
            choices: choices
              .map((c) => ({ ...c, count: 1, share: 100 }))
              .reverse(),
          }),
        }}
        onChangeAnswer={change}
        onNext={next}
        onClose={close}
      />,
    );
    expect(
      screen.getByRole("group", { name: "How people answered" }),
    ).toBeTruthy();
    expect(screen.getAllByText("yours")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toBe(
      "That replaces your earlier answer.",
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(button("Change my answer"));
    expect(change).toHaveBeenCalledOnce();
    await user.click(button("Next"));
    expect(next).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
    await user.click(button("Close"));
    expect(close).toHaveBeenCalledOnce();
  });
  it("empty results remain readable and absent navigation callbacks add no buttons", () => {
    render(
      <VoteCard
        {...base}
        status={{ kind: "answered", changed: false, results: results() }}
      />,
    );
    expect(screen.getByText("Nobody has answered yet.")).toBeTruthy();
    expect(screen.getByText("Counted.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Change my answer" }),
    ).toBeNull();
  });
  it("moves focus to the pending status when Submit becomes disabled", () => {
    const { rerender } = render(<VoteCard {...base} picked={[2]} />);
    button("Submit").focus();
    rerender(<VoteCard {...base} picked={[2]} status={{ kind: "sending" }} />);
    expect(document.activeElement).toBe(screen.getByRole("status"));
    expect((button("Sending…") as HTMLButtonElement).disabled).toBe(true);
  });
  it("focus follows a standalone send into retry and a closed refusal", () => {
    const { rerender } = render(<VoteCard {...base} picked={[2]} />);
    rerender(<VoteCard {...base} picked={[2]} status={{ kind: "sending" }} />);
    rerender(
      <VoteCard
        {...base}
        picked={[2]}
        status={{ kind: "failed", message: "Try again." }}
      />,
    );
    expect(document.activeElement).toBe(button("Try again"));
    rerender(<VoteCard {...base} picked={[2]} status={{ kind: "sending" }} />);
    rerender(<VoteCard {...base} picked={[2]} status={{ kind: "closed" }} />);
    expect(document.activeElement?.textContent).toContain(
      "This one has closed.",
    );
  });
  it("focus follows results and returns to a choice when changing an answer", () => {
    const { rerender } = render(<VoteCard {...base} picked={[2]} />);
    button("Submit").focus();
    rerender(
      <VoteCard
        {...base}
        picked={[2]}
        status={{ kind: "answered", changed: false, results: results() }}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "How people answered" }),
    );
    rerender(<VoteCard {...base} picked={[2]} />);
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Library" }),
    );
  });
});

it("expands an externally collapsed card from the Vote tab", async () => {
  render(
    <Harness
      collapsed
      status={{ kind: "answered", changed: false, results: results() }}
    />,
  );
  expect(
    screen.queryByRole("group", { name: "How people answered" }),
  ).toBeNull();
  await userEvent.click(button("Vote"));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "How people answered" }),
    ),
  );
});
