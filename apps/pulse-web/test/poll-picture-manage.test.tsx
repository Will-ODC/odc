// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { pictureChangedMessage } from "../src/api/pictures.js";
import { ApiError, type PublicImage, type PulseApi } from "../src/api/types.js";
import { SIGNED_IN_KEY } from "../src/flow/sign-in-return.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, stubApi } from "./stub-api.js";

const postedId = "b4c9e661-7f81-4d79-a6bd-689851959651";
const replacementId = "c10d43c6-7055-455e-a93a-be7ea8ad83cc";
const draftId = "6c904f82-96bb-48cb-adce-4a8367cb9592";
const person = (id: string) => ({
  id,
  email: `${id}@example.test`,
  community: null,
});
const poster = person("poster");
const visitor = person("visitor");

function uploaded(id: string, alt: string): PublicImage {
  return {
    kind: "upload",
    displayUrl: `/api/poll-images/${id}/display.webp`,
    thumbUrl: `/api/poll-images/${id}/thumb.webp`,
    width: 640,
    height: 480,
    alt,
  };
}

const originalAlt = "A bench by the path";
const replacementAlt = "A bench beside the pond";
const originalImage = uploaded(postedId, originalAlt);
const replacementImage = uploaded(replacementId, replacementAlt);
const question = poll({
  image: originalImage,
  attribution: { kind: "anonymous" },
  closesAt: "2099-11-27T20:00:00.000Z",
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(over: Partial<PulseApi>) {
  render(
    <Conversation
      api={stubApi({
        me: async () => poster,
        poll: async () => question,
        ...over,
      })}
      pollId={question.id}
    />,
  );
  return userEvent.setup();
}

function action(name: string) {
  return screen.getByRole("button", { name });
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  const summary = await screen.findByText("Manage picture", {
    selector: "summary",
  });
  // jsdom does not activate a native summary on Enter.
  await user.click(summary);
  expect(document.activeElement).toBe(summary);
  return within(screen.getByRole("group", { name: "Picture" }));
}

function picturePicker() {
  const input = screen
    .getByRole("group", { name: "Picture" })
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The picture picker is missing.");
  return input;
}

function mockPreviewUrl() {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () => "blob:replacement";
      static override revokeObjectURL = () => {};
    },
  );
}

async function confirmRemoval(user: ReturnType<typeof userEvent.setup>) {
  action("Remove posted picture").focus();
  await user.keyboard("{Enter}");
  const confirm = action("Remove picture");
  expect(document.activeElement).toBe(confirm);
}

it("lets the anonymous poster replace and remove an upload without changing the question", async () => {
  mockPreviewUrl();
  const pollPictureAccess = vi.fn(async () => true);
  const changePollPicture = vi.fn<PulseApi["changePollPicture"]>(
    async (_id, change) =>
      "expectedImageId" in change ? { kind: "tile" } : replacementImage,
  );
  const user = open({
    pollPictureAccess,
    changePollPicture,
    uploadPicture: async (file) =>
      file.name === "draft.jpg" ? draftId : replacementId,
  });
  expect(await screen.findByRole("img", { name: originalAlt })).toBeTruthy();
  const closingTime = screen.getByText(/^Closes /).textContent;
  const field = await expand(user);
  expect(pollPictureAccess).toHaveBeenCalledExactlyOnceWith(question.id);

  await confirmRemoval(user);
  expect(
    screen.getByText("Remove this picture from the question?"),
  ).toBeTruthy();
  expect(changePollPicture).not.toHaveBeenCalled();
  await user.click(action("Cancel"));
  expect(document.activeElement).toBe(action("Remove posted picture"));

  const choose = field.getByRole("button", { name: "Choose a picture" });
  choose.focus();
  await user.keyboard("{Enter}");
  await user.upload(
    picturePicker(),
    new File(["draft"], "draft.jpg", { type: "image/jpeg" }),
  );
  const replace = await field.findByRole("button", { name: "Replace" });
  replace.focus();
  await user.keyboard("{Enter}");
  await user.upload(
    picturePicker(),
    new File(["new"], "bench.jpg", { type: "image/jpeg" }),
  );
  const description = field.getByRole("textbox", {
    name: "Picture description",
  });
  await user.type(description, replacementAlt);
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();
  action("Save picture").focus();
  await user.keyboard("{Enter}");

  const saved = await screen.findByText("Picture saved.");
  await waitFor(() => expect(document.activeElement).toBe(saved));
  expect(changePollPicture).toHaveBeenNthCalledWith(1, question.id, {
    id: replacementId,
    alt: replacementAlt,
  });
  expect(screen.getByRole("img", { name: replacementAlt })).toBeTruthy();
  expect(screen.queryByRole("img", { name: originalAlt })).toBeNull();

  await confirmRemoval(user);
  expect(screen.queryByText("Picture saved.")).toBeNull();
  expect(changePollPicture).toHaveBeenCalledTimes(1);
  await user.keyboard("{Enter}");
  const removed = await screen.findByText("Picture removed.");
  await waitFor(() => expect(document.activeElement).toBe(removed));
  expect(changePollPicture).toHaveBeenNthCalledWith(2, question.id, {
    expectedImageId: replacementId,
  });
  const main = within(screen.getByRole("main"));
  expect(main.queryByRole("img")).toBeNull();
  expect(
    main.getByRole("heading", { level: 1, name: question.question }),
  ).toBeTruthy();
  expect(main.getByText("Posted anonymously")).toBeTruthy();
  expect(main.getByText(/^Closes /).textContent).toBe(closingTime);
  for (const choice of question.choices)
    expect(main.getByRole("radio", { name: choice })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();
});

it.each([
  ["a signed-in non-poster", visitor, 1],
  ["a signed-out visitor", null, 0],
] as const)("shows no control to %s", async (_label, viewer, reads) => {
  // An anonymous question, even with an unexpected permission in the public
  // body, offers nothing without a true answer from the private route.
  const untrusted = { ...question, canManage: true };
  const pollPictureAccess = vi.fn(async () => false);
  open({
    me: async () => viewer,
    poll: async () => untrusted,
    pollPictureAccess,
  });
  expect(await screen.findByText("Posted anonymously")).toBeTruthy();
  await waitFor(() => expect(pollPictureAccess).toHaveBeenCalledTimes(reads));
  expect(screen.queryByText("Manage picture")).toBeNull();
});

it("keeps removal hidden after a conflict until a reload shows a newer picture", async () => {
  let image = originalImage;
  const user = open({
    poll: async () => ({ ...question, image }),
    pollPictureAccess: async () => true,
    changePollPicture: async () => {
      throw new ApiError(409, pictureChangedMessage, "image_changed");
    },
  });
  await expand(user);
  await confirmRemoval(user);
  await user.keyboard("{Enter}");

  const alert = await screen.findByText(pictureChangedMessage);
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();
  await user.click(action("Reload picture"));
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();

  image = replacementImage;
  await user.click(action("Reload picture"));
  expect(await screen.findByRole("img", { name: replacementAlt })).toBeTruthy();
  expect(document.activeElement).toBe(action("Remove posted picture"));
  expect(screen.queryByText(pictureChangedMessage)).toBeNull();
});

it("keeps the uploaded draft through expiry and rechecks permission before it can be saved", async () => {
  mockPreviewUrl();
  let me: typeof poster | null = poster;
  const pollPictureAccess = vi.fn(async () => true);
  const changePollPicture = vi
    .fn<PulseApi["changePollPicture"]>()
    .mockImplementationOnce(async () => {
      me = null;
      throw new ApiError(401, "Sign in to continue.", "signed_out");
    })
    .mockResolvedValueOnce(replacementImage);
  const user = open({
    me: async () => me,
    poll: async () => ({ ...question, votePrivacy: "public" }),
    pollPictureAccess,
    uploadPicture: async () => replacementId,
    changePollPicture,
  });
  const field = await expand(user);
  await user.upload(
    picturePicker(),
    new File(["new"], "bench.jpg", { type: "image/jpeg" }),
  );
  const description = await field.findByRole("textbox", {
    name: "Picture description",
  });
  await user.type(description, replacementAlt);
  await user.click(action("Save picture"));

  const signIn = await screen.findByRole("link", {
    name: "Sign in again in a new tab",
  });
  expect(signIn.getAttribute("target")).toBe("_blank");
  expect(signIn.getAttribute("href")).toBe(`/sign-in?poll=${question.id}`);
  expect(document.activeElement).toBe(signIn.parentElement);
  expect(description).toHaveProperty("value", replacementAlt);
  expect(action("Save picture").closest("fieldset")?.disabled).toBe(true);
  expect(pollPictureAccess).toHaveBeenCalledTimes(1);
  pollPictureAccess.mockClear();
  let confirmPermission!: () => void;
  const checkedPermission = new Promise<boolean>((resolve) => {
    confirmPermission = () => resolve(true);
  });
  pollPictureAccess.mockImplementation(() => checkedPermission);

  me = poster;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  // A browser blurs the notice when the permission check hides the editor.
  signIn.parentElement?.blur();
  await act(async () => confirmPermission());
  await waitFor(() =>
    expect(screen.queryByText("Sign in again in a new tab")).toBeNull(),
  );
  expect(pollPictureAccess).toHaveBeenCalledWith(question.id);
  expect(document.activeElement).toBe(
    field.getByRole("button", { name: "Replace" }),
  );
  expect(description).toHaveProperty("value", replacementAlt);
  await user.click(action("Save picture"));
  expect(await screen.findByRole("img", { name: replacementAlt })).toBeTruthy();
  expect(changePollPicture).toHaveBeenNthCalledWith(2, question.id, {
    id: replacementId,
    alt: replacementAlt,
  });
});

it("closes the editor for another account and restores access for the returning poster", async () => {
  let me = poster;
  let denyVisitor!: () => void;
  const visitorPermission = new Promise<boolean>((resolve) => {
    denyVisitor = () => resolve(false);
  });
  const pollPictureAccess = vi.fn(() =>
    me === poster ? Promise.resolve(true) : visitorPermission,
  );
  const user = open({ me: async () => me, pollPictureAccess });
  await expand(user);

  me = visitor;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  await waitFor(() => expect(screen.queryByText("Manage picture")).toBeNull());
  expect(screen.getByText("Posted anonymously")).toBeTruthy();

  me = poster;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  const manage = await screen.findByText("Manage picture", {
    selector: "summary",
  });
  expect(manage.closest("details")?.open).toBe(false);

  await act(async () => denyVisitor());
  expect(screen.getByText("Manage picture")).toBe(manage);
});

it("rechecks picture permission on focus after a temporary failure", async () => {
  const pollPictureAccess = vi
    .fn(async () => true)
    .mockRejectedValueOnce(
      new ApiError(503, "Try again.", "images_unavailable"),
    );
  open({ pollPictureAccess });

  await waitFor(() => expect(pollPictureAccess).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Manage picture")).toBeNull();

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(await screen.findByText("Manage picture")).toBeTruthy();
});

it("hides the previous poster's draft while an account change is unverified", async () => {
  mockPreviewUrl();
  let me = poster;
  let failAccountRead = false;
  const user = open({
    me: async () => {
      if (failAccountRead) throw new ApiError(503, "Try again.");
      return me;
    },
    pollPictureAccess: async () => me === poster,
    uploadPicture: async () => replacementId,
  });
  await expand(user);
  await user.upload(
    picturePicker(),
    new File(["new"], "bench.jpg", { type: "image/jpeg" }),
  );
  await user.type(
    await screen.findByRole("textbox", { name: "Picture description" }),
    replacementAlt,
  );

  me = visitor;
  failAccountRead = true;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  expect(
    screen.queryByRole("textbox", { name: "Picture description" }),
  ).toBeNull();
  expect(screen.getByText("Manage picture").closest("details")?.hidden).toBe(
    true,
  );

  failAccountRead = false;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.queryByText("Manage picture")).toBeNull();

  me = poster;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  const field = await expand(user);
  expect(
    field.queryByRole("textbox", { name: "Picture description" }),
  ).toBeNull();
});

it("keeps removal blocked for a conflicted picture after switching accounts", async () => {
  let me = poster;
  const user = open({
    me: async () => me,
    pollPictureAccess: async () => me === poster,
    changePollPicture: async () => {
      throw new ApiError(409, pictureChangedMessage, "image_changed");
    },
  });
  await expand(user);
  await confirmRemoval(user);
  await user.keyboard("{Enter}");
  await screen.findByText(pictureChangedMessage);

  me = visitor;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  expect(screen.queryByText("Manage picture")).toBeNull();

  me = poster;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  await expand(user);
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();
  expect(action("Reload picture")).toBeTruthy();
});

it("keeps removal blocked for a conflicted public poll after signing out and back in", async () => {
  let me: typeof poster | null = poster;
  const user = open({
    me: async () => me,
    poll: async () => ({ ...question, votePrivacy: "public" }),
    pollPictureAccess: async () => me === poster,
    changePollPicture: async () => {
      throw new ApiError(409, pictureChangedMessage, "image_changed");
    },
  });
  await expand(user);
  await confirmRemoval(user);
  await user.keyboard("{Enter}");
  await screen.findByText(pictureChangedMessage);

  me = null;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_OUT_KEY })),
  );
  expect(screen.queryByText("Manage picture")).toBeNull();

  me = poster;
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY })),
  );
  await expand(user);
  expect(
    screen.queryByRole("button", { name: "Remove posted picture" }),
  ).toBeNull();
  expect(action("Reload picture")).toBeTruthy();
});
