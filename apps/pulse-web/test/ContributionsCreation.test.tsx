// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NewContribution } from "../src/screens/NewContribution.js";
import { ContributionsError } from "../src/api/contributions.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("requires sign-in before creating and retains the intended return", async () => {
  render(
    <NewContribution api={stubApi()} client={client()} onCreated={vi.fn()} />,
  );
  expect(
    await screen.findByRole("heading", { name: "Sign in to get started" }),
  ).toBeTruthy();
  const links = screen.getAllByRole("link", { name: "Sign in" });
  expect(
    links.some(
      (link) => link.getAttribute("href") === "/sign-in?next=contribution-new",
    ),
  ).toBe(true);
});

it("publishes a group buy linked to a poll after public confirmation", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue(fixture());
  const onCreated = vi.fn();
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client({ create })}
      onCreated={onCreated}
    />,
  );
  await user.selectOptions(
    await screen.findByLabelText("Contribution type"),
    "group_buy",
  );
  await user.type(
    screen.getByLabelText("Related question (optional)"),
    "https://pulse.example/?poll=garden-poll",
  );
  await user.type(screen.getByLabelText("Title"), "Community tool purchase");
  await user.type(screen.getByLabelText(/Description/), "Buy tools together.");
  await user.type(
    screen.getByLabelText(/Organizer’s public name/),
    "Test organizer",
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(create).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith("park"));
  expect(create.mock.calls[0]?.[0]).toEqual({
    title: "Community tool purchase",
    description: "Buy tools together.",
    organizerName: "Test organizer",
    kind: "group_buy",
    pollId: "garden-poll",
  });
});

it("styles every control on the new contribution form as a shared field", async () => {
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client()}
      onCreated={vi.fn()}
    />,
  );
  for (const label of [
    "Contribution type",
    "Title",
    "Description",
    "Organizer’s public name",
    "Related question (optional)",
  ])
    expect((await screen.findByLabelText(label)).classList).toContain(
      "field__control",
    );
});

it("refuses a related question that is not a question link or ID, at the field", async () => {
  const create = vi.fn().mockResolvedValue(fixture());
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client({ create })}
      onCreated={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Title"), "Community garden");
  await user.type(screen.getByLabelText("Description"), "Grow food together.");
  await user.type(screen.getByLabelText("Organizer’s public name"), "Ada");
  const related = screen.getByLabelText("Related question (optional)");
  await user.type(related, "https://pulse.example/questions/garden");
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(create).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(related);
  expect(related.getAttribute("aria-invalid")).toBe("true");
  expect(related.getAttribute("aria-describedby")).toContain(
    "contribution-poll-problem",
  );
  expect(
    screen.getByText(
      "This is not a question link or ID. Paste the question’s link, or leave this blank.",
    ),
  ).toBeTruthy();
  await user.clear(related);
  await user.type(related, "garden");
  await user.tab();
  expect(related.getAttribute("aria-invalid")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() =>
    expect(create.mock.calls[0]?.[0]).toMatchObject({ pollId: "garden" }),
  );
});

it("keeps every contribution field after an unknown related poll is rejected", async () => {
  const create = vi
    .fn()
    .mockRejectedValue(
      new ContributionsError(
        404,
        "Check the related question or leave that field blank.",
      ),
    );
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client({ create })}
      onCreated={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Title"), "Community garden");
  await user.type(screen.getByLabelText("Description"), "Grow food together.");
  await user.type(screen.getByLabelText("Organizer’s public name"), "Ada");
  await user.type(
    screen.getByLabelText("Related question (optional)"),
    "missing",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  // One message, beside the field: no second, form-level alert.
  const related = screen.getByLabelText("Related question (optional)");
  await waitFor(() =>
    expect(related.getAttribute("aria-invalid")).toBe("true"),
  );
  expect(
    screen.queryByText("Check the related question or leave that field blank."),
  ).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(related));
  expect(related.getAttribute("aria-invalid")).toBe("true");
  expect(related.getAttribute("aria-describedby")).toContain(
    "contribution-poll-problem",
  );
  expect(
    screen.getByText(
      "We could not find that question. Check the link, or leave this blank.",
    ),
  ).toBeTruthy();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "Community garden",
  );
  expect(
    (screen.getByLabelText("Related question (optional)") as HTMLInputElement)
      .value,
  ).toBe("missing");
});
