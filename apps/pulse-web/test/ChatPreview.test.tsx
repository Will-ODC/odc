// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_DECISION, SEND_FAILED } from "../src/flow/chat-preview.js";
import { ChatPreview } from "../src/screens/ChatPreview.js";
import { installDialog } from "./dialog-polyfill.js";

beforeAll(installDialog);
afterEach(cleanup);

const QUESTION = SAMPLE_DECISION.question;
const now = () => Promise.resolve();

/**
 * A send that waits until the test lets it through, and counts how many
 * times one was started - which is how a second send would show itself.
 */
function held() {
  const releases: (() => void)[] = [];
  return {
    wait: () => new Promise<void>((resolve) => releases.push(resolve)),
    started: () => releases.length,
    release: () => releases.forEach((go) => go()),
  };
}

function dialog() {
  return screen.getByRole("dialog", { name: QUESTION });
}

function noDialog() {
  expect(screen.queryByRole("dialog")).toBeNull();
}

async function openIt(name = "Answer") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  return user;
}

/**
 * Every choice is switched off - through the fieldset, so the inputs' own
 * `disabled` stays false and only `:disabled` tells - and pressing one picks
 * nothing.
 */
async function expectNoPicking() {
  const radios = screen.getAllByRole("radio");
  for (const radio of radios) expect(radio.matches(":disabled")).toBe(true);
  await userEvent.click(radios[0]!);
  expect(radios.some((radio) => (radio as HTMLInputElement).checked)).toBe(
    false,
  );
}

async function choose(state: string) {
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Preview state" }),
    state,
  );
}

describe("the page", () => {
  it("is labelled as a preview", () => {
    render(<ChatPreview wait={now} />);
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(
      screen.getByText(/Nothing you do here is sent or saved/),
    ).toBeTruthy();
  });

  it("shows the conversation with the decision closed", () => {
    render(<ChatPreview wait={now} />);
    const chat = screen.getByRole("list", { name: "Conversation" });
    expect(within(chat).getByText(QUESTION)).toBeTruthy();
    noDialog();
  });
});

describe("opening the decision", () => {
  it("shows the question, its choices and that the answer is private", async () => {
    render(<ChatPreview wait={now} />);
    await openIt();

    const popup = dialog();
    expect(popup).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual(
      SAMPLE_DECISION.choices.map((choice) => choice.label),
    );
    expect(screen.getByText("Your answer is private.")).toBeTruthy();
  });

  it("puts focus on the first choice", async () => {
    render(<ChatPreview wait={now} />);
    await openIt();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByRole("radio")[0]),
    );
  });

  it("keeps Submit off until a choice is picked", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    const submit = screen.getByRole("button", { name: "Submit" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("radio", { name: "Wednesday" }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows one choice only", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("radio", { name: "Thursday" }));
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Thursday" })).toBe(checked[0]);
  });
});

describe("answering", () => {
  it("confirms as a prototype, then shows the answer in the chat", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Thursday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    const said = await screen.findByText(/nothing was sent or recorded/);
    expect(said.textContent).toContain("Thursday");
    expect(screen.getByText("Prototype only")).toBeTruthy();
    /* Not yet in the chat: the person is still looking at the popup. */
    expect(screen.queryByText("My answer: Thursday")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Back to the conversation" }),
    );

    noDialog();
    expect(screen.getByText("My answer: Thursday")).toBeTruthy();
    expect(screen.getByText("Only you can see this.")).toBeTruthy();
    const opener = screen.getByRole("button", { name: "Change your answer" });
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the answer when the confirmation is closed with Escape", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Prototype only");

    await user.keyboard("{Escape}");

    noDialog();
    expect(screen.getByText("My answer: Tuesday")).toBeTruthy();
  });

  it("reopens on the answer already given", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(
      await screen.findByRole("button", { name: "Back to the conversation" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Change your answer" }),
    );
    expect(
      (screen.getByRole("radio", { name: "Tuesday" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("cannot send twice from a double press", async () => {
    const send = held();
    render(<ChatPreview wait={send.wait} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Wednesday" }));

    await user.dblClick(screen.getByRole("button", { name: "Submit" }));

    const sending = screen.getByRole("button", { name: "Sending…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    expect(send.started()).toBe(1);

    send.release();
    expect(await screen.findByText("Prototype only")).toBeTruthy();
    expect(send.started()).toBe(1);
  });
});

describe("closing without answering", () => {
  it("leaves no answer after Escape, and focus back on the opener", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Thursday" }));

    await user.keyboard("{Escape}");

    noDialog();
    expect(screen.queryByText(/My answer/)).toBeNull();
    const opener = screen.getByRole("button", { name: "Answer" });
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(0);
  });

  it("leaves no answer after Close, and focus back on the opener", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Thursday" }));

    await user.click(screen.getByRole("button", { name: "Close" }));

    noDialog();
    expect(screen.queryByText(/My answer/)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Answer" }),
    );
  });

  /*
   * A send that lands after the popup was closed must not turn a dismissed
   * question into an answered one, or reopen on a confirmation.
   */
  it("forgets a send still on its way", async () => {
    const send = held();
    render(<ChatPreview wait={send.wait} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Thursday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();

    await user.keyboard("{Escape}");
    send.release();
    await Promise.resolve();

    noDialog();
    expect(screen.queryByText(/My answer/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Answer" }));
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(screen.queryByText("Prototype only")).toBeNull();
  });
});

describe("a failed send after the popup closed", () => {
  it("is forgotten too, so the popup reopens without the failure", async () => {
    const send = held();
    render(<ChatPreview wait={send.wait} />);
    await choose("sendFails");
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Thursday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await user.keyboard("{Escape}");
    send.release();
    await Promise.resolve();

    await user.click(screen.getByRole("button", { name: "Answer" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });
});

describe("someone not yet confirmed", () => {
  it("sees the choices but cannot answer, and is told why", async () => {
    render(<ChatPreview wait={now} />);
    await choose("unconfirmed");
    await openIt("See the question");

    expect(dialog()).toBeTruthy();
    /* Nothing to pick, so focus starts on the way out. */
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    await expectNoPicking();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(
      screen.getByText(/Only confirmed members can answer this question/),
    ).toBeTruthy();
  });
});

describe("a closed poll", () => {
  it("says it is closed and takes no answer", async () => {
    render(<ChatPreview wait={now} />);
    await choose("closed");
    expect(screen.getByText("DECISION · CLOSED")).toBeTruthy();
    await openIt("See the question");

    await expectNoPicking();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByText(/This question has closed/)).toBeTruthy();
  });
});

describe("a send that fails", () => {
  it("says so in one sentence, and Try again recovers", async () => {
    render(<ChatPreview wait={now} />);
    await choose("sendFails");
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(SEND_FAILED);
    expect(screen.queryByText("Prototype only")).toBeNull();
    const again = screen.getByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(again);

    await user.click(again);

    expect(await screen.findByText("Prototype only")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Back to the conversation" }),
    );
    expect(screen.getByText("My answer: Tuesday")).toBeTruthy();
  });

  it("fails afresh after the preview state is switched back", async () => {
    render(<ChatPreview wait={now} />);
    await choose("sendFails");
    let user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await choose("eligible");
    await choose("sendFails");
    user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("switching the preview state", () => {
  it("starts the conversation over", async () => {
    render(<ChatPreview wait={now} />);
    const user = await openIt();
    await user.click(screen.getByRole("radio", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(
      await screen.findByRole("button", { name: "Back to the conversation" }),
    );
    expect(screen.getByText("My answer: Tuesday")).toBeTruthy();

    await choose("closed");
    await choose("eligible");

    expect(screen.queryByText(/My answer/)).toBeNull();
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
  });
});

describe("with a keyboard only", () => {
  it("opens, picks, sends and returns without a pointer", async () => {
    const user = userEvent.setup();
    render(<ChatPreview wait={now} />);

    await user.tab(); // the preview state
    await user.tab(); // the opener
    const opener = screen.getByRole("button", { name: "Answer" });
    expect(document.activeElement).toBe(opener);
    await user.keyboard("{Enter}");

    expect(dialog()).toBeTruthy();
    await user.keyboard(" "); // ticks the focused, first choice
    expect(
      (screen.getByRole("radio", { name: "Tuesday" }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Submit" }),
    );
    await user.keyboard("{Enter}");

    const back = await screen.findByRole("button", {
      name: "Back to the conversation",
    });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await user.keyboard("{Enter}");

    noDialog();
    expect(screen.getByText("My answer: Tuesday")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Change your answer" }),
    );
  });
});
