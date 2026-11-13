// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { MemberProfile } from "../src/api/types.js";
import { SIGNED_IN_KEY } from "../src/flow/sign-in-return.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
import { ProfileEditor } from "../src/screens/ProfileEditor.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);
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
