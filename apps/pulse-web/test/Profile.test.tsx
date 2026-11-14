// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ApiError,
  type MemberProfile,
  type PulseApi,
} from "../src/api/types.js";
import { MemberProfile as MemberProfileScreen } from "../src/screens/MemberProfile.js";
import { ProfileEditor } from "../src/screens/ProfileEditor.js";
import { stubApi } from "./stub-api.js";

const EMPTY_CONTRIBUTIONS = {
  forProfile: () => Promise.resolve({ contributions: [], nextCursor: null }),
  mine: () => Promise.resolve({ contributions: [], nextCursor: null }),
};

afterEach(cleanup);
beforeEach(() => globalThis.history.replaceState(null, "", "/"));
beforeAll(() =>
  vi.stubGlobal("CSS", {
    escape: (value: string) =>
      value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  }),
);
afterAll(() => vi.unstubAllGlobals());

const PROFILE: MemberProfile = {
  publicId: "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8",
  displayName: "Ada",
  bio: "Neighbour and gardener.",
  visible: true,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
};

describe("public member profile", () => {
  it("covers loading and content without showing private account data", async () => {
    let finish!: (profile: MemberProfile) => void;
    render(
      <MemberProfileScreen
        api={stubApi({
          profile: () => new Promise((resolve) => (finish = resolve)),
        })}
        publicId={PROFILE.publicId}
        contributions={EMPTY_CONTRIBUTIONS}
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    finish(PROFILE);
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(screen.getByText("Neighbour and gardener.")).toBeTruthy();
    expect(screen.getByText("Profile created November 12, 2026")).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("shows the same clear unavailable state for a 404", async () => {
    render(
      <MemberProfileScreen
        api={stubApi({
          profile: () => Promise.reject(new ApiError(404, "unavailable")),
        })}
        publicId="missing"
        contributions={EMPTY_CONTRIBUTIONS}
      />,
    );
    expect(await screen.findByText(/This profile is unavailable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Pulse home" })).toBeTruthy();
  });

  it("renders profile markup-looking text literally", async () => {
    const { container } = render(
      <MemberProfileScreen
        api={stubApi({
          profile: () =>
            Promise.resolve({
              ...PROFILE,
              displayName: "<b>x</b>",
              bio: "<script>",
            }),
        })}
        publicId={PROFILE.publicId}
        contributions={EMPTY_CONTRIBUTIONS}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "<b>x</b>" }),
    ).toBeTruthy();
    expect(screen.getByText("<script>")).toBeTruthy();
    expect(container.querySelector("b, script")).toBeNull();
  });

  it("shows an error and retries from the keyboard", async () => {
    const user = userEvent.setup();
    const profile = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(PROFILE);
    render(
      <MemberProfileScreen
        api={stubApi({ profile })}
        publicId={PROFILE.publicId}
        contributions={EMPTY_CONTRIBUTIONS}
      />,
    );
    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(profile).toHaveBeenCalledTimes(2);
  });

  it("lists contributions and shows management only to its owner", async () => {
    const page = {
      contributions: [
        {
          id: "garden",
          title: "Community garden",
          description: "Grow food together.",
          communityBenefit: "",
          needs: "",
          kind: "project" as const,
          organizerName: "Ada",
          community: { id: "pulse-general", label: "General" },
          pollId: null,
          commercial: null,
          fund: null,
          status: "open" as const,
          createdAt: "2026-11-12T13:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    const sameNameDifferentAccount = render(
      <MemberProfileScreen
        api={stubApi({
          profile: () => Promise.resolve(PROFILE),
          myProfile: () =>
            Promise.resolve({ ...PROFILE, publicId: "another-public-id" }),
        })}
        publicId={PROFILE.publicId}
        contributions={{
          forProfile: () => Promise.resolve(page),
          mine: () => Promise.reject(new Error("must stay private")),
        }}
      />,
    );
    expect(
      (
        await screen.findByRole("link", { name: "Community garden" })
      ).getAttribute("href"),
    ).toBe("/contributions/garden");
    expect(
      screen.queryByRole("link", { name: "Start a contribution" }),
    ).toBeNull();
    expect(screen.queryByText("Your contributions")).toBeNull();
    sameNameDifferentAccount.unmount();

    const myProfile = vi.fn(() => Promise.resolve(PROFILE));
    const mine = vi.fn(() => Promise.resolve(page));
    render(
      <MemberProfileScreen
        api={stubApi({
          me: async () => ({
            id: "ada",
            email: "ada@example.test",
            community: null,
          }),
          profile: () => Promise.resolve(PROFILE),
          myProfile,
        })}
        publicId={PROFILE.publicId}
        contributions={{
          forProfile: () => Promise.resolve(page),
          mine,
        }}
      />,
    );
    expect(
      (
        await screen.findByRole("link", { name: "Start a contribution" })
      ).getAttribute("href"),
    ).toBe("/contributions/new");
    expect(await screen.findByText("Your contributions")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Post an update" }).getAttribute("href"),
    ).toBe("/contributions/garden#updates");
    expect(
      screen
        .getByRole("link", { name: "Organizer inbox" })
        .getAttribute("href"),
    ).toBe("/contributions/garden#messages");
    // The owner list is read for the account the owner check saw, so an
    // account switch is refused by the server instead of shown here.
    expect(myProfile).toHaveBeenCalledWith("ada");
    expect(mine).toHaveBeenCalledWith(undefined, "ada");
  });

  it("shows no owner controls when nobody is signed in", async () => {
    const myProfile = vi.fn(() => Promise.resolve(PROFILE));
    const mine = vi.fn(() =>
      Promise.resolve({ contributions: [], nextCursor: null }),
    );
    render(
      <MemberProfileScreen
        api={stubApi({ profile: () => Promise.resolve(PROFILE), myProfile })}
        publicId={PROFILE.publicId}
        contributions={{ ...EMPTY_CONTRIBUTIONS, mine }}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("No contributions published yet.")).toBeTruthy(),
    );
    expect(screen.queryByText("Your contributions")).toBeNull();
    expect(myProfile).not.toHaveBeenCalled();
    expect(mine).not.toHaveBeenCalled();
  });
});

// Owner routes now wait for the banner's signed-in account before reading.
function ownerApi(over: Partial<PulseApi>) {
  return stubApi({
    me: async () => ({ id: "ada", email: "ada@example.test", community: null }),
    ...over,
  });
}

describe("owner profile editor", () => {
  it("covers loading, signed-out empty and recoverable error states", async () => {
    const pending = new Promise<MemberProfile | null>(() => {});
    const first = render(
      <ProfileEditor api={ownerApi({ myProfile: () => pending })} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    first.unmount();

    const signedOut = render(
      <ProfileEditor
        api={ownerApi({
          me: async () => null,
          myProfile: () => Promise.reject(new ApiError(401, "signed out")),
        })}
      />,
    );
    expect(await screen.findByText(/Sign in to create/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" })).toHaveLength(2);
    expect(
      screen
        .getAllByRole("link", { name: "Sign in" })
        .some((link) => link.getAttribute("href") === "/sign-in?next=profile"),
    ).toBe(true);
    signedOut.unmount();

    const myProfile = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    render(<ProfileEditor api={ownerApi({ myProfile })} />);
    await screen.findByText(/couldn't load your profile/i);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Public display name")).toBeTruthy();
  });

  it("creates, hides and reshares with labels and keyboard controls", async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn(async (request) => ({
      ...PROFILE,
      ...request,
      updatedAt: "2026-11-12T12:01:00.000Z",
    }));
    render(
      <ProfileEditor
        api={ownerApi({
          myProfile: () => Promise.resolve(null),
          saveProfile,
        })}
      />,
    );
    const name = await screen.findByLabelText("Public display name");
    name.focus();
    await user.keyboard("Ada{Tab}Neighbour and gardener.{Tab}");
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: /Public/ }),
    );
    await user.keyboard("{ArrowDown}{Tab}{Enter}");

    await waitFor(() => expect(saveProfile).toHaveBeenCalledOnce());
    expect(saveProfile).toHaveBeenCalledWith({
      ownerAccountId: "ada",
      displayName: "Ada",
      bio: "Neighbour and gardener.",
      visible: false,
    });
    expect(await screen.findByText("Your profile is hidden.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy link/ })).toBeNull();

    await user.click(screen.getByRole("radio", { name: /Public/ }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText(/ready to share/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy link to profile for Ada" }),
    ).toBeTruthy();
  });

  it("validates limits on blur and does not save invalid text", async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn();
    render(
      <ProfileEditor
        api={ownerApi({ myProfile: () => Promise.resolve(null), saveProfile })}
      />,
    );
    const name = await screen.findByLabelText("Public display name");
    await user.click(name);
    await user.tab();
    expect(screen.getByText("Enter a display name.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("explains an invisible name under the field instead of sending it", async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn();
    render(
      <ProfileEditor
        api={ownerApi({ myProfile: () => Promise.resolve(null), saveProfile })}
      />,
    );
    const name = await screen.findByLabelText("Public display name");
    await user.click(name);
    await user.keyboard("\u200B\u200D");
    await user.tab();
    expect(screen.getByText("Enter a name people can see.")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("puts a refused save in plain words and the error colour, then clears it on edit", async () => {
    const user = userEvent.setup();
    render(
      <ProfileEditor
        api={ownerApi({
          myProfile: () => Promise.resolve(PROFILE),
          saveProfile: () =>
            Promise.reject(
              new ApiError(400, "That request could not be read."),
            ),
        })}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Save profile" }),
    );
    const status = await screen.findByText(
      "We couldn't save that name or bio. Check them and try again.",
    );
    expect(status.className).toContain("profile__status--error");
    expect(screen.queryByText("That request could not be read.")).toBeNull();

    await user.type(screen.getByLabelText("Public display name"), "!");
    expect(
      screen.queryByText(
        "We couldn't save that name or bio. Check them and try again.",
      ),
    ).toBeNull();
    expect(screen.getByRole("status").className).not.toContain("--error");
  });

  it("keeps keyboard focus on Save while saving and after", async () => {
    const user = userEvent.setup();
    let finish!: (profile: MemberProfile) => void;
    const saveProfile = vi.fn(
      () => new Promise<MemberProfile>((resolve) => (finish = resolve)),
    );
    render(
      <ProfileEditor
        api={ownerApi({
          myProfile: () => Promise.resolve(PROFILE),
          saveProfile,
        })}
      />,
    );
    const save = await screen.findByRole("button", { name: "Save profile" });
    save.focus();
    await user.keyboard("{Enter}");
    const saving = await screen.findByRole("button", { name: "Saving…" });
    // Disabling the focused control is what threw focus to the top of the page.
    expect(saving).toBe(save);
    expect((saving as HTMLButtonElement).disabled).toBe(false);
    expect(saving.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("group", { name: "Who can see it?" })).toBeTruthy();
    expect(
      (screen.getByLabelText("Public display name") as HTMLInputElement)
        .readOnly,
    ).toBe(true);
    expect(document.activeElement).toBe(save);
    // The button already says "Saving…"; the status line does not repeat it.
    expect(screen.getAllByText("Saving…")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(saveProfile).toHaveBeenCalledOnce();

    finish(PROFILE);
    expect(await screen.findByText(/ready to share/)).toBeTruthy();
    expect(document.activeElement).toBe(save);
    expect(save.textContent).toBe("Save profile");
  });

  it("says Not saved yet until a change is saved, and links a shared profile", async () => {
    const user = userEvent.setup();
    render(
      <ProfileEditor
        api={ownerApi({
          myProfile: () => Promise.resolve({ ...PROFILE, visible: false }),
        })}
      />,
    );
    expect(await screen.findByText("Your profile is hidden.")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "View your profile" }),
    ).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Public/ }));
    expect(screen.getByRole("status").textContent).toBe("Not saved yet.");
    expect(
      screen.queryByRole("link", { name: "View your profile" }),
    ).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Hidden/ }));
    expect(screen.getByRole("status").textContent).toBe(
      "Your profile is hidden.",
    );
    cleanup();

    render(
      <ProfileEditor
        api={ownerApi({ myProfile: () => Promise.resolve(PROFILE) })}
      />,
    );
    expect(
      (
        await screen.findByRole("link", { name: "View your profile" })
      ).getAttribute("href"),
    ).toBe(`/u/${PROFILE.publicId}`);
  });
});

describe("compact states", () => {
  it("keeps the public empty and error states and the signed-out editor compact", async () => {
    const missing = render(
      <MemberProfileScreen
        api={stubApi({
          profile: () => Promise.reject(new ApiError(404, "unavailable")),
        })}
        publicId="missing"
      />,
    );
    await screen.findByText(/This profile is unavailable/);
    expect(missing.container.querySelector(".viewstate--compact")).toBeTruthy();
    missing.unmount();

    const failed = render(
      <MemberProfileScreen
        api={stubApi({ profile: () => Promise.reject(new Error("offline")) })}
        publicId={PROFILE.publicId}
      />,
    );
    await screen.findByRole("button", { name: "Try again" });
    expect(failed.container.querySelector(".viewstate--compact")).toBeTruthy();
    failed.unmount();

    const signedOut = render(
      <ProfileEditor
        api={stubApi({
          me: async () => null,
          myProfile: () => Promise.reject(new ApiError(401, "signed out")),
        })}
      />,
    );
    await screen.findByText(/Sign in to create/);
    expect(
      signedOut.container.querySelector(".viewstate--compact"),
    ).toBeTruthy();
  });
});
