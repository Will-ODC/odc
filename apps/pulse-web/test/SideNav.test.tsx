// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideNav } from "../src/components/SideNav.js";

afterEach(cleanup);

const walked = [
  { id: "ads-free", question: "Should the ODC stay free of paid ads?" },
  { id: "pay-for-it", question: "How do we pay for it?" },
];

describe("the path the run has taken", () => {
  it("lists every question the run has been through", () => {
    render(<SideNav steps={walked} current={1} onGoTo={vi.fn()} />);
    expect(screen.getByText(walked[0]!.question)).toBeTruthy();
    expect(screen.getByText(walked[1]!.question)).toBeTruthy();
  });

  it("marks the question being asked now", () => {
    render(<SideNav steps={walked} current={1} onGoTo={vi.fn()} />);
    expect(
      screen.getByText(walked[1]!.question).getAttribute("aria-current"),
    ).toBe("step");
  });

  /*
   * The question already showing is not a control. A button that goes nowhere
   * still takes a tab stop and still answers a press, which is how a nav
   * teaches people that pressing it does nothing.
   */
  it("does not offer the question being asked as something to press", () => {
    render(<SideNav steps={walked} current={1} onGoTo={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: walked[1]!.question }),
    ).toBeNull();
  });

  it("goes back to an earlier question when it is pressed", async () => {
    const onGoTo = vi.fn();
    render(<SideNav steps={walked} current={1} onGoTo={onGoTo} />);
    await userEvent.click(
      screen.getByRole("button", { name: walked[0]!.question }),
    );
    expect(onGoTo).toHaveBeenCalledWith(0);
  });

  /*
   * The accessibility floor: every gesture and every press has a key that
   * does the same thing. A rail reachable only by mouse is a rail that half
   * the people using it cannot open.
   */
  it("goes back from the keyboard alone", async () => {
    const onGoTo = vi.fn();
    render(<SideNav steps={walked} current={1} onGoTo={onGoTo} />);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe(walked[0]!.question);
    await userEvent.keyboard("{Enter}");
    expect(onGoTo).toHaveBeenCalledWith(0);
  });

  /*
   * A step is listed the moment the run walks through it. Waiting for the
   * wording would make the rail flicker in and out as somebody moves, so a
   * question whose poll has not loaded is named by its position instead.
   */
  it("names a question by its position until its wording arrives", () => {
    render(
      <SideNav
        steps={[walked[0]!, { id: "pay-for-it" }]}
        current={1}
        onGoTo={vi.fn()}
      />,
    );
    expect(screen.getByText("Question 2")).toBeTruthy();
  });
});
