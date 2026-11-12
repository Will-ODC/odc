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
import { ApiError, type MemberProfile } from "../src/api/types.js";
import { MemberProfile as MemberProfileScreen } from "../src/screens/MemberProfile.js";
import { ProfileEditor } from "../src/screens/ProfileEditor.js";
import { stubApi } from "./stub-api.js";

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
      />,
    );
    expect(await screen.findByText(/This profile is unavailable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Pulse home" })).toBeTruthy();
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
      />,
    );
    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(profile).toHaveBeenCalledTimes(2);
  });
});

describe("owner profile editor", () => {
  it("covers loading, signed-out empty and recoverable error states", async () => {
    const pending = new Promise<MemberProfile | null>(() => {});
    const first = render(
      <ProfileEditor api={stubApi({ myProfile: () => pending })} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    first.unmount();

    const signedOut = render(
      <ProfileEditor
        api={stubApi({
          myProfile: () => Promise.reject(new ApiError(401, "signed out")),
        })}
      />,
    );
    expect(await screen.findByText(/Sign in to create/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" })).toHaveLength(2);
    signedOut.unmount();

    const myProfile = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    render(<ProfileEditor api={stubApi({ myProfile })} />);
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
        api={stubApi({
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
        api={stubApi({ myProfile: () => Promise.resolve(null), saveProfile })}
      />,
    );
    const name = await screen.findByLabelText("Public display name");
    await user.click(name);
    await user.tab();
    expect(screen.getByText("Enter a display name.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(saveProfile).not.toHaveBeenCalled();
  });
});
