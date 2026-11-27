// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import type {
  Contribution,
  ContributionsApi,
} from "../src/api/contributions.js";
import { ContributionsError } from "../src/api/contributions.js";
import { ApiError } from "../src/api/types.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
  parkPictureId,
  parkPicture,
  switchableMe,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  {
    name: "rechecks the session when a managed picture upload is signed out",
    failsOnSave: false,
    sameAccount: false,
  },
  {
    name: "rechecks the session when Save picture returns 401",
    failsOnSave: true,
    sameAccount: false,
  },
  {
    name: "unlocks upload controls when the same organizer is already signed in",
    failsOnSave: false,
    sameAccount: true,
  },
  {
    name: "unlocks save controls when the same organizer is already signed in",
    failsOnSave: true,
    sameAccount: true,
  },
])("$name", async ({ failsOnSave, sameAccount }) => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("ada");
  let uploadCount = 0;
  let refused = false;
  let finishRecheck!: () => void;
  const recheck = new Promise<void>((resolve) => {
    finishRecheck = resolve;
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () => "blob:park";
      static override revokeObjectURL = () => {};
    },
  );
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => {
          if (refused) await recheck;
          return me();
        },
        uploadPicture: async () => {
          if (++uploadCount === 1) return "replacement";
          refused = true;
          state.who = sameAccount ? "ada" : null;
          throw new ApiError(401, "Sign in.", "signed_out");
        },
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        changePicture: async () => {
          if (!failsOnSave) return parkPicture;
          refused = true;
          state.who = sameAccount ? "ada" : null;
          throw new ContributionsError(401, "Sign in.", "signed_out");
        },
      })}
    />,
  );
  const summary = await screen.findByText("Manage picture");
  await user.click(summary);
  const field = screen.getByRole("group", { name: "Picture" });
  const input = field.querySelector<HTMLInputElement>('input[type="file"]')!;
  const upload = (name: string) =>
    user.upload(input, new File([name], name, { type: "image/jpeg" }));
  await upload("park.jpg");
  const description = screen.getByLabelText<HTMLTextAreaElement>(
    "Picture description",
  );
  await user.type(description, parkPicture.alt);
  if (failsOnSave)
    await user.click(screen.getByRole("button", { name: "Save picture" }));
  else await upload("ramp.jpg");

  const choose = await screen.findByRole("button", { name: "Replace" });
  await screen.findByRole("link", { name: "Sign in again in a new tab" });
  expect(screen.queryByText("Sign in to change this picture.")).toBeNull();
  expect(choose.matches(":disabled")).toBe(true);
  if (sameAccount) window.dispatchEvent(new Event("focus"));
  await act(async () => finishRecheck());
  if (sameAccount) {
    await user.click(
      screen.getByRole("button", { name: "Check sign-in again" }),
    );
    await waitFor(() => expect(choose.matches(":disabled")).toBe(false));
    expect(
      screen.queryByRole("link", { name: "Sign in again in a new tab" }),
    ).toBeNull();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Picture description").value,
    ).toBe(parkPicture.alt);
    return;
  }
  await screen.findByText(/to read your private messages/);
  const panel = screen.getByText("Manage picture").closest("details")!;
  expect(panel.open).toBe(true);
  const picture = within(panel);
  expect(
    picture.getByLabelText<HTMLTextAreaElement>("Picture description").value,
  ).toBe(parkPicture.alt);
  const link = picture.getByRole("link", {
    name: "Sign in again in a new tab",
  });
  expect(link.getAttribute("href")).toBe("/sign-in?contribution=park");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  if (!failsOnSave) {
    state.who = "ada";
    window.dispatchEvent(new Event("focus"));
    await screen.findByText("Private messages", { selector: "summary" });
    expect(picture.queryByRole("link", { name: /Sign in again/ })).toBeNull();
    await user.click(picture.getByRole("button", { name: "Save picture" }));
    expect(await picture.findByText("Picture saved.")).toBeTruthy();
  }
});

it("asks for the picture again when a signed-out upload drops it", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("ada");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () => "blob:park";
      static override revokeObjectURL = () => {};
    },
  );
  render(
    <ContributionDetail
      api={stubApi({
        me,
        uploadPicture: async () => {
          state.who = null;
          throw new ApiError(401, "Sign in.", "signed_out");
        },
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
      })}
    />,
  );
  await user.click(await screen.findByText("Manage picture"));
  await user.upload(
    screen
      .getByRole("group", { name: "Picture" })
      .querySelector<HTMLInputElement>('input[type="file"]')!,
    new File(["park"], "park.jpg", { type: "image/jpeg" }),
  );
  expect(
    await screen.findByText(/Choose your picture again after you sign in\./),
  ).toBeTruthy();
});

it("puts the organizer byline directly after the title for a tile picture", async () => {
  render(<ContributionDetail api={stubApi()} id="park" client={client()} />);
  const heading = await screen.findByRole("heading", {
    name: fixture().title,
    level: 1,
  });
  expect(screen.queryByRole("img", { name: "General" })).toBeNull();
  expect(heading.nextElementSibling).toBe(
    screen.getByText("Organized by Test organizer · General"),
  );
});

it.each([
  "visitor",
  "picture reply first",
  "picture reply last",
  "lost removal reply",
  "picture already removed",
  "conflict refresh fails",
  "removed elsewhere, refresh fails",
  "update reply before conflict refresh",
])("manages the displayed picture safely (%s)", async (order) => {
  const canManage = order !== "visitor";
  const newer = {
    ...parkPicture,
    displayUrl: "/api/poll-images/newer/display.webp",
    alt: "Another picture",
  };
  const late = order === "update reply before conflict refresh";
  const gone = order === "removed elsewhere, refresh fails";
  const conflict =
    late ||
    gone ||
    order === "picture already removed" ||
    order === "conflict refresh fails";
  const session = switchableMe("ada");
  let held: Promise<void> | undefined;
  let release!: () => void;
  let failReads = false;
  const user = userEvent.setup();
  let item = fixture({ image: parkPicture });
  let finishRemoval!: () => void;
  let finishUpdate!: (value: Contribution) => void;
  const changePicture = vi.fn<ContributionsApi["changePicture"]>(async () => {
    item =
      order === "picture reply first"
        ? fixture({
            status: "completed",
            updates: [
              {
                id: "newer",
                status: "completed",
                message: "The ramp is finished.",
                createdAt: "2026-11-11T12:30:00.000Z",
                evidenceUrl: null,
              },
            ],
          })
        : fixture();
    await new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    if (order === "lost removal reply")
      throw new ContributionsError(0, "Connection lost.");
    if (conflict && changePicture.mock.calls.length === 1)
      throw new ContributionsError(409, "Picture changed.", "image_changed");
    return { kind: "tile" };
  });
  render(
    <ContributionDetail
      api={stubApi({ me: session.me })}
      id="park"
      client={client({
        detail: async () => {
          if (held) await held;
          if (failReads)
            throw new ContributionsError(0, "Could not read picture.");
          return { contribution: item, canManage };
        },
        changePicture,
        update: () =>
          new Promise((resolve) => {
            finishUpdate = resolve;
          }),
      })}
    />,
  );
  const image = await screen.findByRole("img", { name: parkPicture.alt });
  expect(image.getAttribute("src")).toBe(parkPicture.displayUrl);
  if (!canManage) {
    expect(screen.queryByText("Manage picture")).toBeNull();
    fireEvent.error(image);
    expect(screen.queryByRole("img", { name: parkPicture.alt })).toBeNull();
    return;
  }
  if ((!conflict && order !== "lost removal reply") || late) {
    await user.click(await screen.findByText("Post an update"));
    await user.type(screen.getByLabelText("Progress update"), "Ramp started");
    await user.click(screen.getByLabelText(/I confirm this status and update/));
    await user.click(screen.getByRole("button", { name: "Publish update" }));
  }
  const stale = item;
  await user.click(await screen.findByText("Manage picture"));
  const remove = () =>
    screen.getByRole("button", {
      name: "Remove posted picture",
    });
  expect(remove().closest("header")).toBeNull();
  remove().focus();
  await user.keyboard("{Enter}");
  const confirm = screen.getByRole("button", { name: "Remove picture" });
  expect(document.activeElement).toBe(confirm);
  expect(
    screen.getByText("Remove this picture from the contribution?"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(remove());
  expect(changePicture).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  await user.keyboard("{Enter}");
  const pending = screen.getByRole("button", { name: "Removing picture…" });
  expect(document.activeElement).toBe(pending);
  expect(pending.getAttribute("aria-disabled")).toBe("true");
  expect(changePicture).toHaveBeenCalledExactlyOnceWith("park", {
    expectedImageId: parkPictureId,
  });
  if (order !== "picture reply first") item = fixture({ image: newer });
  if (order === "picture reply last") {
    await act(async () => finishUpdate(item));
    await screen.findByRole("img", { name: newer.alt });
    held = new Promise(() => {});
  }
  if (late) held = new Promise((resolve) => (release = resolve));
  if (order === "picture already removed" || gone) item = fixture();
  failReads = order === "conflict refresh fails" || gone;
  await act(async () => finishRemoval());
  if (late) {
    // While the conflict refresh is out, the update's reply lands with a
    // fresh copy of the refused picture; the refresh's own follow-up read
    // then never answers.
    await act(async () => finishUpdate(fixture({ image: { ...parkPicture } })));
    held = new Promise(() => {});
    await act(async () => release());
  }
  if (conflict) {
    expect(await screen.findByText("Picture changed.")).toBeTruthy();
    expect(screen.queryByText("Picture removed.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove picture" })).toBeNull();
    if (late) {
      await screen.findByRole("img", { name: newer.alt });
      expect(remove()).toBeTruthy();
    }
    if (gone) {
      failReads = false;
      await user.click(screen.getByRole("button", { name: "Reload picture" }));
      const reloaded = await screen.findByText("Picture reloaded.");
      expect(screen.queryByText("Picture changed.")).toBeNull();
      expect(screen.queryByRole("img", { name: "General" })).toBeNull();
      expect(screen.queryByRole("img", { name: parkPicture.alt })).toBeNull();
      expect(document.activeElement).toBe(reloaded);
      return;
    }
    if (failReads) {
      expect(
        screen.queryByRole("button", { name: "Remove posted picture" }),
      ).toBeNull();
      const reload = () =>
        screen.getByRole("button", { name: "Reload picture" });
      await user.click(reload());
      expect(
        await screen.findByText("Could not load the picture. Try again."),
      ).toBeTruthy();
      // Signed out, there is nothing to reload the picture for.
      session.state.who = null;
      window.dispatchEvent(new Event("focus"));
      await screen.findByText(/to read your private messages/);
      expect(
        screen.queryByRole("button", { name: "Reload picture" }),
      ).toBeNull();
      session.state.who = "ada";
      window.dispatchEvent(new Event("focus"));
      await screen.findByText("Private messages", { selector: "summary" });
      failReads = false;
      await user.click(reload());
      await screen.findByRole("img", { name: newer.alt });
      expect(document.activeElement).toBe(remove());
      await user.keyboard("{Enter}");
      await user.keyboard("{Enter}");
      await act(async () => finishRemoval());
      expect(await screen.findByText("Picture removed.")).toBeTruthy();
      expect(screen.queryByText("Picture reloaded.")).toBeNull();
    }
    return;
  }
  if (order === "lost removal reply") {
    await screen.findByRole("img", { name: newer.alt });
    expect(remove()).toBeTruthy();
    expect(
      screen.getByText(
        "The posted picture changed. Review it before removing.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Connection lost.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove picture" })).toBeNull();
    return;
  }
  expect(await screen.findByText("Picture removed.")).toBeTruthy();
  if (order === "picture reply last") {
    expect(screen.getByRole("img", { name: newer.alt })).toBeTruthy();
    return;
  }
  expect(screen.queryByRole("img", { name: "General" })).toBeNull();
  expect(screen.queryByRole("img", { name: parkPicture.alt })).toBeNull();
  await screen.findByText("The ramp is finished.");
  await act(async () => finishUpdate(stale));
  expect(screen.getByLabelText("Current status")).toHaveProperty(
    "value",
    "completed",
  );
  expect(screen.getByText("The ramp is finished.")).toBeTruthy();
  expect(
    await screen.findByText("Your update has been published."),
  ).toBeTruthy();
  expect(screen.queryByRole("img", { name: parkPicture.alt })).toBeNull();
});

it.each(["saved", "expired", "expired, check fails", "lost reply"])(
  "handles a replacement picture (%s)",
  async (outcome) => {
    const expired = outcome.startsWith("expired");
    let checkFails = false;
    const user = userEvent.setup();
    const replacement = {
      ...parkPicture,
      alt: "A new ramp",
      displayUrl: "/api/poll-images/replacement/display.webp",
    };
    let item = fixture({ image: parkPicture });
    const changePicture = vi.fn<ContributionsApi["changePicture"]>(async () => {
      checkFails = outcome === "expired, check fails";
      if (expired)
        throw new ContributionsError(422, "Expired.", "image_unavailable");
      item = { ...item, image: replacement };
      if (outcome === "lost reply")
        throw new ContributionsError(0, "Connection lost.");
      return replacement;
    });
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = () => "blob:park";
        static override revokeObjectURL = () => {};
      },
    );
    render(
      <ContributionDetail
        api={stubApi({
          me: switchableMe("ada").me,
          uploadPicture: async () => "replacement",
        })}
        id="park"
        client={client({
          detail: async () => {
            if (checkFails) throw new ContributionsError(0, "Read failed.");
            return { contribution: item, canManage: true };
          },
          changePicture,
        })}
      />,
    );
    await user.click(await screen.findByText("Manage picture"));
    const field = screen.getByRole("group", { name: "Picture" });
    await user.upload(
      field.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["park"], "park.jpg", { type: "image/jpeg" }),
    );
    const picture = within(field);
    const description = await picture.findByLabelText("Picture description");
    const choose = () =>
      picture.getByRole("button", { name: "Choose a picture" });
    expect(
      screen.queryByRole("button", { name: "Remove posted picture" }),
    ).toBeNull();
    const save = screen.getByRole("button", { name: "Save picture" });
    await user.click(save);
    expect(
      picture.getByText(/Describe the picture before you save/),
    ).toBeTruthy();
    await user.type(description, replacement.alt);
    await user.click(save);
    expect(changePicture).toHaveBeenCalledExactlyOnceWith("park", {
      id: "replacement",
      alt: replacement.alt,
    });
    if (expired) {
      expect(
        await picture.findByRole("button", {
          name: "Choose a picture",
          description: /Choose it again\. Its description is kept\./,
        }),
      ).toBeTruthy();
      expect(screen.getByRole("img", { name: parkPicture.alt })).toBeTruthy();
      expect((description as HTMLTextAreaElement).value).toBe(replacement.alt);
      expect(
        screen.queryByRole("button", { name: "Remove posted picture" }),
      ).toBeNull();
      expect(document.activeElement).toBe(choose());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save picture" })).toBeNull();
    } else {
      expect(await screen.findByText("Picture saved.")).toBeTruthy();
      expect(
        await screen.findByRole("img", { name: replacement.alt }),
      ).toBeTruthy();
      expect(screen.queryByRole("img", { name: parkPicture.alt })).toBeNull();
      expect(choose()).toBeTruthy();
      expect(picture.queryByLabelText("Picture description")).toBeNull();
      await user.click(
        screen.getByRole("button", { name: "Remove posted picture" }),
      );
      expect(
        screen.getByRole("button", { name: "Remove picture" }),
      ).toBeTruthy();
      expect(screen.queryByText("Picture saved.")).toBeNull();
    }
  },
);
