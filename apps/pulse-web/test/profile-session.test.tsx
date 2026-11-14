// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  ApiError,
  type MemberProfile,
  type ProfileRequest,
} from "../src/api/types.js";
import { SIGNED_IN_KEY } from "../src/flow/sign-in-return.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
import { ProfileEditor } from "../src/screens/ProfileEditor.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);
// These tests remount the editor and chain several reads; under the full,
// parallel suite that can pass the default 1s wait. Give them room.
configure({ asyncUtilTimeout: 3000 });
const person = (id: string) => ({
  id,
  email: `${id}@example.test`,
  community: null,
});
const profile = (id: string): MemberProfile => ({
  publicId: id,
  displayName: `Name ${id}`,
  bio: `Bio ${id}`,
  visible: false,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(over: Parameters<typeof stubApi>[0] = {}) {
  let who: string | null = "a";
  const myProfile = vi.fn(async () => profile(who!));
  const saveProfile = vi.fn(async () => profile(who!));
  render(
    <ProfileEditor
      api={stubApi({
        me: async () => (who ? person(who) : null),
        signOut: async () => {
          who = null;
        },
        myProfile,
        saveProfile,
        ...over,
      })}
    />,
  );
  return {
    myProfile,
    saveProfile,
    async switchTo(id: string | null, key?: string) {
      who = id;
      await act(async () => {
        window.dispatchEvent(
          key ? new StorageEvent("storage", { key }) : new Event("focus"),
        );
      });
    },
  };
}
const name = () =>
  screen.getByLabelText("Public display name") as HTMLInputElement;
const bio = () =>
  screen.getByLabelText("Bio (optional)") as HTMLTextAreaElement;
async function loaded(id = "a") {
  await waitFor(() => expect(name().value).toBe(`Name ${id}`));
}
async function signOutHere() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(screen.getByRole("button", { name: /^Sign out$/ }));
  await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
}
it("clears the hidden name and bio after signing out through Account", async () => {
  setup();
  await loaded();
  expect(bio().value).toBe("Bio a");
  await signOutHere();
  expect(screen.queryByDisplayValue("Name a")).toBeNull();
  expect(screen.queryByDisplayValue("Bio a")).toBeNull();
});

it("clears the hidden name and bio after another tab signs out", async () => {
  const app = setup();
  await loaded();
  await app.switchTo(null, SIGNED_OUT_KEY);
  expect(screen.queryByDisplayValue("Name a")).toBeNull();
  expect(screen.queryByDisplayValue("Bio a")).toBeNull();
});

it("remounts for account B and removes A while B's profile loads", async () => {
  const b = deferred<MemberProfile>();
  const myProfile = vi
    .fn()
    .mockResolvedValueOnce(profile("a"))
    .mockReturnValueOnce(b.promise);
  const app = setup({ myProfile });
  await loaded();
  fireEvent.change(name(), { target: { value: "A draft" } });
  await app.switchTo("b", SIGNED_IN_KEY);
  expect(screen.queryByDisplayValue("A draft")).toBeNull();
  expect(screen.queryByDisplayValue("Bio a")).toBeNull();
  expect(myProfile).toHaveBeenCalledTimes(2);
  await act(async () => b.resolve(profile("b")));
  await loaded("b");
});

it("keeps an expired draft, blocks save, and restores saving for the same account", async () => {
  const app = setup();
  await loaded();
  fireEvent.change(name(), { target: { value: "My draft" } });
  fireEvent.change(bio(), { target: { value: "Draft bio" } });
  await app.switchTo(null);
  const link = screen.getByRole("link", { name: "Sign in again in a new tab" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  expect(link.closest('[role="status"]')?.textContent).toBe(
    "Your sign-in has ended. What you wrote stays here. Sign in again in a new tab to save it.",
  );
  expect(name().value).toBe("My draft");
  expect(bio().value).toBe("Draft bio");
  expect(
    (screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.submit(name().closest("form")!);
  expect(app.saveProfile).not.toHaveBeenCalled();
  await app.switchTo("a", SIGNED_IN_KEY);
  expect(name().value).toBe("My draft");
  expect(bio().value).toBe("Draft bio");
  expect(
    (screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.submit(name().closest("form")!);
  await waitFor(() =>
    expect(app.saveProfile).toHaveBeenCalledWith({
      ownerAccountId: "a",
      displayName: "My draft",
      bio: "Draft bio",
      visible: false,
    }),
  );
});

it("ignores an in-flight save answered after sign-out", async () => {
  const saving = deferred<MemberProfile>();
  const saveProfile = vi.fn(() => saving.promise);
  const app = setup({ saveProfile });
  await loaded();
  fireEvent.submit(name().closest("form")!);
  expect(saveProfile).toHaveBeenCalledTimes(1);
  await app.switchTo(null, SIGNED_OUT_KEY);
  await act(async () => saving.resolve(profile("late-save")));
  expect(screen.queryByDisplayValue("Name late-save")).toBeNull();
  expect(screen.queryByLabelText("Public display name")).toBeNull();
});

it("ignores A's profile read when it arrives after B signed in", async () => {
  const a = deferred<MemberProfile>();
  const myProfile = vi
    .fn()
    .mockReturnValueOnce(a.promise)
    .mockResolvedValueOnce(profile("b"));
  const app = setup({ myProfile });
  await waitFor(() => expect(myProfile).toHaveBeenCalledTimes(1));
  await app.switchTo("b", SIGNED_IN_KEY);
  await act(async () => a.resolve(profile("a")));
  await loaded("b");
  expect(screen.queryByDisplayValue("Bio a")).toBeNull();
});

it("refuses A's draft with B's cookie while the session recheck is pending, then clears and reloads", async () => {
  const recheck = deferred<ReturnType<typeof person>>();
  const reload = deferred<ReturnType<typeof person>>();
  let cookieOwner = "a";
  const stored = { a: profile("a"), b: profile("b") };
  const before = structuredClone(stored);
  const me = vi
    .fn()
    .mockResolvedValueOnce(person("a"))
    .mockReturnValueOnce(recheck.promise)
    .mockReturnValueOnce(reload.promise);
  const saveProfile = vi.fn(async (request: ProfileRequest) => {
    if (request.ownerAccountId !== cookieOwner)
      throw new ApiError(409, "Account changed", "account_changed");
    stored.b = { ...stored.b, ...request };
    return stored.b;
  });
  setup({
    me,
    myProfile: async () => stored[cookieOwner as "a" | "b"],
    saveProfile,
  });
  await loaded();
  fireEvent.change(name(), { target: { value: "A private draft" } });
  cookieOwner = "b";
  fireEvent(window, new StorageEvent("storage", { key: SIGNED_IN_KEY }));
  expect(me).toHaveBeenCalledTimes(2);
  fireEvent.submit(name().closest("form")!);
  await waitFor(() => expect(me).toHaveBeenCalledTimes(3));
  expect(saveProfile).toHaveBeenCalledWith({
    ownerAccountId: "a",
    displayName: "A private draft",
    bio: "Bio a",
    visible: false,
  });
  expect(screen.queryByLabelText("Public display name")).toBeNull();
  expect(screen.getByText(/Your account changed/)).toBeTruthy();
  expect(stored).toEqual(before);
  await act(async () => reload.resolve(person("b")));
  await loaded("b");
  await act(async () => recheck.resolve(person("a")));
  expect(name().value).toBe("Name b");
  expect(stored).toEqual(before);
});

it("reads the profile again when the same account signs back in after the first read got a 401", async () => {
  let first = true;
  const { switchTo } = setup({
    myProfile: vi.fn(async () => {
      if (first) {
        first = false;
        throw new ApiError(401, "Sign in to continue.");
      }
      return profile("a");
    }),
  });
  expect(
    (
      await screen.findAllByText(
        "Sign in to create or change your public profile.",
      )
    ).length,
  ).toBeGreaterThan(0);
  await switchTo(null);
  await switchTo("a", SIGNED_IN_KEY);
  await waitFor(() => expect(name().value).toBe("Name a"));
});

it.each(["storage", "focus", "visibilitychange"])(
  "recovers the first owner read's 401 on %s without observing a sign-out",
  async (trigger) => {
    const me = vi.fn(async () => person("a"));
    const myProfile = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "Sign in to continue."))
      .mockResolvedValueOnce(profile("a"));
    setup({ me, myProfile });
    expect(
      (
        await screen.findAllByText(
          "Sign in to create or change your public profile.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(myProfile).toHaveBeenCalledTimes(1);

    // The same account signs in elsewhere before any session recheck saw
    // the expiry: every me() answer still reports account A.
    await act(async () => {
      if (trigger === "storage")
        window.dispatchEvent(
          new StorageEvent("storage", { key: SIGNED_IN_KEY }),
        );
      else if (trigger === "focus") window.dispatchEvent(new Event("focus"));
      else document.dispatchEvent(new Event("visibilitychange"));
    });
    await loaded();
    expect(bio().value).toBe("Bio a");
    expect(myProfile).toHaveBeenCalledTimes(2);
    expect(me).toHaveBeenCalledTimes(2);

    // Once loaded, a return to the tab must preserve the current draft.
    fireEvent.change(name(), { target: { value: "Recovered draft" } });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(myProfile).toHaveBeenCalledTimes(2);
    expect(name().value).toBe("Recovered draft");
  },
);

it.each([null, "b"])(
  "ignores a recovery read answered after the account changes to %s",
  async (nextAccount) => {
    const recovery = deferred<MemberProfile>();
    const myProfile = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "Sign in to continue."))
      .mockReturnValueOnce(recovery.promise)
      .mockResolvedValueOnce(profile("b"));
    const app = setup({ myProfile });
    await screen.findAllByText(
      "Sign in to create or change your public profile.",
    );
    await app.switchTo("a", SIGNED_IN_KEY);
    expect(myProfile).toHaveBeenCalledTimes(2);
    await app.switchTo(
      nextAccount,
      nextAccount === null ? SIGNED_OUT_KEY : SIGNED_IN_KEY,
    );
    if (nextAccount !== null) await loaded("b");
    await act(async () => recovery.resolve(profile("a")));
    expect(screen.queryByDisplayValue("Name a")).toBeNull();
    expect(screen.queryByDisplayValue("Bio a")).toBeNull();
    if (nextAccount === null)
      expect(screen.queryByLabelText("Public display name")).toBeNull();
    else expect(name().value).toBe("Name b");
  },
);

it("never fills A's form from a read the server says was for another account", async () => {
  // The page believes A is signed in throughout (no recheck has seen B), but
  // the cookie belongs to B when the recovery read goes out.
  const myProfile = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(401, "Sign in to continue."))
    .mockRejectedValueOnce(
      new ApiError(409, "Your account changed.", "account_changed"),
    )
    .mockResolvedValue(profile("a"));
  setup({ me: vi.fn(async () => person("a")), myProfile });
  expect(
    (
      await screen.findAllByText(
        "Sign in to create or change your public profile.",
      )
    ).length,
  ).toBeGreaterThan(0);
  await act(async () => window.dispatchEvent(new Event("focus")));
  // The refused read is dropped and the editor starts again for A.
  await waitFor(() => expect(name().value).toBe("Name a"));
  expect(screen.queryByDisplayValue("Name b")).toBeNull();
  expect(myProfile.mock.calls.every(([owner]) => owner === "a")).toBe(true);
  expect(myProfile.mock.calls.length).toBeGreaterThanOrEqual(3);
});

/**
 * Run `act` synchronously the first time `shown` finds something on screen,
 * from a MutationObserver: after React commits that screen, before its passive
 * effects run. A person can type or switch tabs in that gap too.
 */
function onFirstShown<T>(shown: () => T | null, act: (found: T) => void) {
  let done = false;
  const observer = new MutationObserver(() => {
    const found = done ? null : shown();
    if (found === null) return;
    done = true;
    observer.disconnect();
    act(found);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

it("keeps a draft typed the moment the form first appears", async () => {
  let typed = false;
  const stop = onFirstShown(
    () =>
      screen.queryByLabelText("Public display name") as HTMLInputElement | null,
    (input) => {
      fireEvent.change(input, { target: { value: "Typed at once" } });
      typed = true;
    },
  );
  setup();
  await waitFor(() => expect(typed).toBe(true));
  stop();
  await act(async () => {});
  expect(name().value).toBe("Typed at once");
  expect(screen.getByText("Not saved yet.")).toBeTruthy();
});

it("reads again on a return the moment the first read's Sign in appears", async () => {
  const myProfile = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(401, "Sign in to continue."))
    .mockResolvedValueOnce(profile("a"));
  let returned = false;
  const stop = onFirstShown(
    () =>
      screen.queryAllByText("Sign in to create or change your public profile.")
        .length > 0 || null,
    () => {
      window.dispatchEvent(new Event("focus"));
      returned = true;
    },
  );
  setup({ me: vi.fn(async () => person("a")), myProfile });
  await waitFor(() => expect(returned).toBe(true));
  stop();
  await loaded();
  expect(myProfile).toHaveBeenCalledTimes(2);
});
