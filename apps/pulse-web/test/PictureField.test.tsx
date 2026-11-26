// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type PulseApi } from "../src/api/types.js";
import { PictureField } from "../src/components/PictureField.js";
import { usePictureField } from "../src/hooks/use-picture-field.js";
import { stubApi } from "./stub-api.js";

const firstId = "0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f";
const secondId = "1b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f";
const photo = new File(["photo"], "playground.jpg", { type: "image/jpeg" });
const replacement = new File(["replacement"], "park.png", {
  type: "image/png",
});
const hint =
  "One picture. JPEG, PNG or WebP, up to 10 MB. Pulse removes location and camera details from it.";
const network =
  "The picture did not upload. Check your connection, then try again. Everything else you wrote is kept.";
const unavailableNow =
  "Pulse cannot take pictures right now. Try again later, or post without a picture. Everything else you wrote is kept.";
const orphan =
  "Choose the picture again, or clear its description to post without a picture.";
const typeProblem =
  "Pulse cannot use this file. Choose a JPEG, PNG or WebP picture. GIF, SVG, HEIC and moving pictures are not accepted.";
const uploadPicture = vi.fn<PulseApi["uploadPicture"]>();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
const api = stubApi({ uploadPicture });
const describePicture = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Picture description",
  });
const button = (name: string) => screen.getByRole("button", { name });
const status = () => screen.getByRole("status").textContent;

const tooSmall =
  "This picture is too small: 150 pixels on its shorter side. Choose one at least 200 pixels on each side.";
const tooWide =
  "This picture is too large: 9,600 pixels wide. Choose one up to 8,000 pixels on each side and 40 megapixels in all.";
const tooTall =
  "This picture is too large: 9,600 pixels tall. Choose one up to 8,000 pixels on each side and 40 megapixels in all.";
const tooManyPixels =
  "This picture is too large: 49 megapixels. Choose one up to 40 megapixels and 8,000 pixels on each side.";
const genericDimensions =
  "This picture is too small or too large. Choose a different picture.";

function jpegFrame(width: number, height: number) {
  return new Uint8Array([
    0xff,
    0xc2,
    0,
    11,
    8,
    height >> 8,
    height,
    width >> 8,
    width,
    1,
    1,
    0x11,
    0,
  ]);
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([
    0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function webpHeader(tag: string, width: number, height: number) {
  const size = tag === "VP8L" ? 5 : 10;
  const bytes = new Uint8Array(20 + size + (size % 2));
  const ascii = new TextEncoder();
  bytes.set(ascii.encode("RIFF"), 0);
  bytes.set(ascii.encode("WEBP" + tag), 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, size, true);
  if (tag === "VP8 ") {
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else if (tag === "VP8L") {
    bytes[20] = 0x2f;
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  } else {
    bytes.set([width - 1, (width - 1) >> 8, (width - 1) >> 16], 24);
    bytes.set([height - 1, (height - 1) >> 8, (height - 1) >> 16], 27);
  }
  return bytes;
}

function refusal(status: number, error: string, retryAfter?: number) {
  return new ApiError(status, "Server wording", error, retryAfter);
}

function holdUpload() {
  let accept!: (id: string) => void;
  let refuse!: (error: ApiError) => void;
  uploadPicture.mockImplementationOnce(
    () =>
      new Promise<string>((resolve, reject) => {
        accept = resolve;
        refuse = reject;
      }),
  );
  return async (error?: ApiError) => {
    await act(async () => {
      if (error) refuse(error);
      else accept(firstId);
    });
  };
}

function renderForm() {
  const posted = vi.fn();
  function Form({ api }: { api: PulseApi }) {
    const [signedOut, setSignedOut] = useState(false);
    const field = usePictureField(() => setSignedOut(true), api);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (field.checkPost()) posted(field.image);
        }}
      >
        <label>
          Title
          <input defaultValue="My draft" />
        </label>
        {signedOut ? (
          <button type="button" onClick={() => setSignedOut(false)}>
            Sign in again
          </button>
        ) : (
          <PictureField field={field} />
        )}
        <button type="submit">Post</button>
        <button
          type="button"
          onClick={() => field.reportPostError("image_unavailable")}
        >
          Simulate expired picture
        </button>
        <button
          type="button"
          onClick={() => field.reportPostError("signed_out")}
        >
          Simulate signed out
        </button>
        <output aria-label="Post may proceed" role="note">
          {String(field.canPost)}
        </output>
      </form>
    );
  }
  const view = render(<Form api={api} />);
  const user = userEvent.setup();
  const fileInput = () =>
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  async function choose(file = photo) {
    // Deliver the result of the native picker without focusing the hidden input.
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [file] } });
    });
  }
  return {
    ...view,
    user,
    input: fileInput(),
    posted,
    choose,
    async ready(description = "Two swings beside a slide") {
      await choose();
      await screen.findByRole("button", { name: "Replace" });
      if (description) await user.type(describePicture(), description);
    },
  };
}

function describedBy(control: HTMLElement) {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent);
}

beforeEach(() => {
  uploadPicture.mockReset().mockResolvedValue(firstId);
  createUrl.mockReset().mockImplementation((file: File) => `blob:${file.name}`);
  revokeUrl.mockClear();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = createUrl;
      static override revokeObjectURL = revokeUrl;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PictureField", () => {
  it("opens the hidden JPEG/PNG/WebP picker with the keyboard and allows an empty Post", async () => {
    const { user, input, posted } = renderForm();
    expect(
      screen.getByRole("group", { name: "Picture (optional)" }),
    ).toBeTruthy();
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(
      screen.queryByRole("textbox", { name: "Picture description" }),
    ).toBeNull();
    expect(describedBy(button("Choose a picture"))).toEqual([hint]);
    const picker = vi.spyOn(input, "click");
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(button("Choose a picture"));
    await user.keyboard("{Enter} ");
    expect(picker).toHaveBeenCalledTimes(2);
    await user.tab();
    expect(document.activeElement).toBe(button("Post"));
    await user.keyboard("{Enter}");
    expect(posted).toHaveBeenCalledWith(undefined);
    expect(uploadPicture).not.toHaveBeenCalled();
  });

  it("previews the file during upload, refuses Post, and sends the trimmed attachment only on another Post", async () => {
    const finish = holdUpload();
    const { choose, user, posted } = renderForm();
    await choose();
    const preview = screen.getByRole("img", {
      name: "Preview of the picture you chose",
    });
    expect(preview.getAttribute("src")).toBe("blob:playground.jpg");
    expect(status()).toBe("Uploading picture…");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(document.activeElement).toBe(button("Cancel upload"));
    await user.type(describePicture(), "  Two swings  ");
    await user.click(button("Post"));
    expect(document.activeElement).toBe(button("Cancel upload"));
    expect(describedBy(button("Cancel upload"))).toEqual([
      hint,
      "Wait for the picture to finish uploading, or cancel it.",
    ]);
    expect(posted).not.toHaveBeenCalled();
    expect(
      screen.getByRole("note", { name: "Post may proceed" }).textContent,
    ).toBe("false");

    await finish();
    expect(status()).toBe("Picture uploaded.");
    expect(screen.getByText(photo.name)).toBeTruthy();
    expect(describePicture().value).toBe("  Two swings  ");
    expect(describedBy(button("Replace"))).toEqual([hint]);
    expect(describedBy(button("Remove"))).toEqual([hint]);
    expect(posted).not.toHaveBeenCalled();
    expect(
      screen.getByRole("note", { name: "Post may proceed" }).textContent,
    ).toBe("true");
    await user.click(button("Post"));
    expect(posted).toHaveBeenCalledExactlyOnceWith({
      id: firstId,
      alt: "Two swings",
    });
    expect(uploadPicture).toHaveBeenCalledExactlyOnceWith(
      photo,
      expect.any(AbortSignal),
    );
  });

  it("requires a non-blank description and counts trimmed Unicode code points", async () => {
    const { ready, user, posted } = renderForm();
    await ready("");
    expect(status()).toBe("Picture uploaded.");
    await user.click(button("Post"));
    expect(screen.queryByText("Picture uploaded.")).toBeNull();
    const description = describePicture();
    expect(document.activeElement).toBe(description);
    expect(description.getAttribute("aria-invalid")).toBe("true");
    expect(description.getAttribute("aria-required")).toBe("true");
    expect(describedBy(description)).toEqual([
      "Required with a picture. Say what it shows, for people who cannot see it. Up to 300 characters.",
      "Describe the picture before you post, or remove it.",
    ]);
    await user.paste(` ${"🌳".repeat(301)} `);
    expect(describedBy(description)[1]).toBe(
      "Keep the description to 300 characters. It is 301 now.",
    );
    await user.click(button("Post"));
    expect(posted).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(description);
    await user.clear(description);
    await user.paste(` ${"🌳".repeat(300)} `);
    expect(description.getAttribute("aria-invalid")).toBe("false");
    await user.click(button("Post"));
    expect(posted).toHaveBeenCalledExactlyOnceWith({
      id: firstId,
      alt: "🌳".repeat(300),
    });
  });

  it("removes the upload and its description by keyboard, returning focus to Choose a picture", async () => {
    const { ready, user, posted } = renderForm();
    await ready("");
    expect(document.activeElement).toBe(button("Replace"));
    await user.tab();
    expect(document.activeElement).toBe(button("Remove"));
    await user.tab();
    await user.keyboard("A tree");
    await user.tab({ shift: true });
    await user.keyboard(" ");
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(status()).toBe("Picture removed.");
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Picture description" }),
    ).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith("blob:playground.jpg");
    await user.click(button("Post"));
    expect(posted).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("replaces the picture, keeps the description and focuses Replace", async () => {
    const finish = holdUpload();
    uploadPicture.mockResolvedValueOnce(secondId);
    const { choose, user, posted } = renderForm();
    await choose();
    await finish();
    await user.type(describePicture(), "My picture description");
    await choose(replacement);
    await waitFor(() =>
      expect(status()).toBe(
        "Picture replaced. Check that the description still fits the new one.",
      ),
    );
    expect(document.activeElement).toBe(button("Replace"));
    expect(describePicture().value).toBe("My picture description");
    expect(revokeUrl).toHaveBeenCalledWith("blob:playground.jpg");
    expect(screen.getByText(replacement.name)).toBeTruthy();
    await user.click(button("Post"));
    expect(posted).toHaveBeenCalledExactlyOnceWith({
      id: secondId,
      alt: "My picture description",
    });
  });

  it("cancels the first upload, ignores its late answer and can choose the same file again", async () => {
    const finish = holdUpload();
    const { choose, user } = renderForm();
    await choose();
    expect(uploadPicture).toHaveBeenCalled();
    const signal = uploadPicture.mock.calls[0]?.[1];
    await user.type(describePicture(), "Unfinished description");
    await user.click(button("Cancel upload"));
    expect(signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(describePicture().value).toBe("Unfinished description");
    await user.click(button("Post"));
    expect(describedBy(describePicture())).toEqual([orphan]);
    await finish();
    expect(screen.queryByRole("img")).toBeNull();
    await choose();
    await screen.findByRole("button", { name: "Replace" });
  });

  it.each(["cancel", "busy", "invalid type"])(
    "restores the old upload when Replace ends with %s",
    async (result) => {
      const { ready, choose, user, posted } = renderForm();
      await ready("Old description");

      if (result === "invalid type") {
        await choose(new File(["gif"], "new.gif", { type: "image/gif" }));
        expect(status()).toBe(typeProblem);
        expect(uploadPicture).toHaveBeenCalledTimes(1);
      } else {
        const finish = holdUpload();
        await choose(replacement);
        await user.type(describePicture(), " edited");
        if (result === "cancel") await user.click(button("Cancel upload"));
        await finish(refusal(503, "image_busy"));
      }
      expect(document.activeElement).toBe(button("Replace"));
      expect(button("Remove")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.queryByText("Not uploaded")).toBeNull();
      expect(screen.getByText(photo.name)).toBeTruthy();
      expect(describePicture().value).toBe("Old description");
      await user.click(button("Post"));
      expect(posted).toHaveBeenCalledExactlyOnceWith({
        id: firstId,
        alt: "Old description",
      });
    },
  );

  it.each([
    ["image/gif", 1, typeProblem],
    [
      "image/jpeg",
      14_889_779,
      "This picture is 14.2 MB. Choose one of 10 MB or less.",
    ],
  ])(
    "refuses invalid files before measuring or uploading (%s, %i bytes)",
    async (type, bytes, message) => {
      const { choose } = renderForm();
      await choose(new File([new Uint8Array(bytes)], "picture", { type }));
      const chooseButton = button("Choose a picture");
      expect(describedBy(chooseButton)).toEqual([hint, message]);
      expect(chooseButton.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(chooseButton);
      expect(uploadPicture).not.toHaveBeenCalled();
    },
  );

  it("accepts a file of exactly 10 MiB for upload", async () => {
    const { choose } = renderForm();
    await choose(
      new File([new Uint8Array(10_485_760)], "boundary.webp", {
        type: "image/webp",
      }),
    );
    await screen.findByRole("button", { name: "Replace" });
    await choose(replacement);
    await waitFor(() => expect(status()).toMatch(/^Picture replaced/));
    expect(uploadPicture).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "PNG IHDR",
      new File([pngHeader(150, 300)], "small.png", { type: "image/png" }),
      tooSmall,
    ],
    [
      "JPEG SOF after metadata",
      new File(
        [
          new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 5, 69, 120, 105, 0xff]),
          jpegFrame(9600, 300),
        ],
        "wide.jpg",
        { type: "image/jpeg" },
      ),
      tooWide,
    ],
    [
      "WebP VP8",
      new File([webpHeader("VP8 ", 300, 9600)], "tall.webp", {
        type: "image/webp",
      }),
      tooTall,
    ],
    [
      "WebP VP8L",
      new File([webpHeader("VP8L", 7000, 7000)], "large.webp", {
        type: "image/webp",
      }),
      tooManyPixels,
    ],
    [
      "WebP VP8X, declared JPEG",
      new File([webpHeader("VP8X", 9600, 300)], "wide.jpg", {
        type: "image/jpeg",
      }),
      tooWide,
    ],
    [
      "truncated PNG",
      new File([pngHeader(150, 300).slice(0, 20)], "short.png", {
        type: "image/png",
      }),
      genericDimensions,
    ],
    [
      "JPEG with a long marker fill and an invalid segment length",
      new File(
        [
          new Uint8Array([0xff, 0xd8]),
          new Uint8Array(60 * 1024).fill(0xff),
          new Uint8Array([0xe1, 0, 1]),
          jpegFrame(9600, 300),
        ],
        "invalid-segment.jpg",
        { type: "image/jpeg" },
      ),
      genericDimensions,
    ],
    [
      "JPEG SOF beyond the read limit",
      new File(
        [
          new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]),
          new Uint8Array(65_533),
          jpegFrame(9600, 300),
        ],
        "metadata.jpg",
        { type: "image/jpeg" },
      ),
      genericDimensions,
    ],
  ])(
    "starts the upload before reading %s, then uses it for the server's dimension refusal",
    async (_name, file, message) => {
      const slice = vi.spyOn(file, "slice");
      const finish = holdUpload();
      const { choose } = renderForm();
      await choose(file);
      expect(uploadPicture).toHaveBeenCalledExactlyOnceWith(
        file,
        expect.any(AbortSignal),
      );
      expect(slice).not.toHaveBeenCalled();
      await finish(refusal(422, "image_dimensions"));
      await screen.findByRole("button", { name: "Choose a picture" });
      expect(describedBy(button("Choose a picture"))).toEqual([hint, message]);
      expect(slice).toHaveBeenCalledExactlyOnceWith(0, 64 * 1024);
      slice.mockRestore();
    },
  );

  it.each([
    [48 * 1024, "48 KB"],
    [511, "1 KB"],
    [1024 * 1024 - 1, "1.0 MB"],
  ])("shows the size of a %i-byte file as %s", async (bytes, size) => {
    const { choose } = renderForm();
    await choose(
      new File([new Uint8Array(bytes)], "small.jpg", {
        type: "image/jpeg",
      }),
    );
    expect(screen.getByText(`· ${size}`)).toBeTruthy();
  });

  it("puts a decorative warning icon before each problem and in the failure badge", async () => {
    const { choose, user } = renderForm();
    await choose(new File(["gif"], "new.gif", { type: "image/gif" }));
    const fileProblem = screen.getByText(typeProblem, { selector: "span" });
    expect(
      fileProblem.previousElementSibling?.getAttribute("aria-hidden"),
    ).toBe("true");

    uploadPicture.mockRejectedValueOnce(refusal(503, "image_busy"));
    await choose();
    const badge = screen.getByText("Not uploaded");
    expect(badge.firstElementChild?.getAttribute("aria-hidden")).toBe("true");

    await user.type(describePicture(), "a");
    await user.paste("a".repeat(300));
    const descriptionProblem = screen.getByText(
      "Keep the description to 300 characters. It is 301 now.",
    );
    expect(
      descriptionProblem.previousElementSibling?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it.each([
    [415, "unsupported_image", undefined, typeProblem],
    [
      413,
      "image_too_large",
      undefined,
      "This picture is 2.4 MB. Choose one of 10 MB or less.",
    ],
    [
      422,
      "image_dimensions",
      undefined,
      "This picture is too small or too large. Choose a different picture.",
    ],
    [
      429,
      "upload_limit",
      undefined,
      "You have uploaded 20 pictures in the last hour, the most allowed. Try again later, or post without a picture.",
    ],
    [
      429,
      "upload_limit",
      61,
      "You have uploaded 20 pictures in the last hour, the most allowed. Try again in 2 minutes, or post without a picture.",
    ],
    [
      429,
      "pending_limit",
      undefined,
      "You have 5 pictures that are not posted yet, the most allowed at once. Unposted pictures clear after a day. Try again tomorrow, or post without a picture.",
    ],
  ])(
    "maps %i %s to the choose-again state (Retry-After %s)",
    async (code, slug, header, message) => {
      uploadPicture.mockRejectedValueOnce(refusal(code, slug, header));
      const { choose } = renderForm();
      await choose(
        new File([new Uint8Array(2_516_582)], "photo.jpg", {
          type: "image/jpeg",
        }),
      );
      await screen.findByRole("button", { name: "Choose a picture" });
      expect(describedBy(button("Choose a picture"))).toEqual([hint, message]);
      expect(screen.queryByRole("img")).toBeNull();
    },
  );

  it.each([
    [0, "network", network],
    [500, "server_error", network],
    [403, "origin_not_allowed", network],
    [
      503,
      "image_busy",
      "Pulse is busy with other pictures. Try again in a minute. Everything else you wrote is kept.",
    ],
    [503, "images_unavailable", unavailableNow],
    [429, "too_many_requests", unavailableNow],
  ])(
    "keeps the file and draft after %i %s, and retries the same file",
    async (code, slug, message) => {
      const { choose, user, posted } = renderForm();
      if (code === 0)
        uploadPicture.mockRejectedValueOnce(new TypeError("Connection lost"));
      else uploadPicture.mockRejectedValueOnce(refusal(code, slug));
      await choose();
      const retry = await screen.findByRole("button", { name: "Try again" });
      expect(describedBy(retry)).toEqual([hint, message]);
      expect(retry.getAttribute("aria-invalid")).toBe("true");
      expect(button("Remove")).toBeTruthy();
      expect(screen.getByText("Not uploaded")).toBeTruthy();
      await user.type(describePicture(), "Kept draft");
      await user.click(button("Post"));
      expect(document.activeElement).toBe(retry);
      expect(posted).not.toHaveBeenCalled();
      await user.keyboard("{Enter}");
      await screen.findByRole("button", { name: "Replace" });
      expect(uploadPicture.mock.calls.map(([file]) => file)).toEqual([
        photo,
        photo,
      ]);
      expect(describePicture().value).toBe("Kept draft");
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value,
      ).toBe("My draft");
    },
  );

  it.each([
    ["Title", 503, "image_busy", "Pulse is busy", "Try again"],
    ["Picture description", 503, "image_busy", "Pulse is busy", "Try again"],
    ["Title", 415, "unsupported_image", typeProblem, "Choose a picture"],
    [
      "Picture description",
      415,
      "unsupported_image",
      typeProblem,
      "Choose a picture",
    ],
  ])(
    "announces a failed first upload without moving the caret in %s (%i %s)",
    async (name, code, slug, message, action) => {
      const finish = holdUpload();
      const { choose, user, posted } = renderForm();
      await choose();
      const editor = screen.getByRole<HTMLInputElement | HTMLTextAreaElement>(
        "textbox",
        { name },
      );
      await user.type(editor, "abc");
      await user.keyboard("{ArrowLeft}");
      const caret = editor.selectionStart;
      await finish(refusal(code, slug));
      expect(status()).toContain(message);
      expect(screen.getByRole("status").getAttribute("aria-live")).toBe(
        "polite",
      );
      expect(document.activeElement).toBe(editor);
      expect(editor.selectionStart).toBe(caret);
      if (action === "Try again") {
        await user.click(button("Post"));
        expect(document.activeElement).toBe(button(action));
        expect(posted).not.toHaveBeenCalled();
      }
    },
  );

  it("transfers focus from Cancel to Choose when the server refuses a first file", async () => {
    const finish = holdUpload();
    const { choose } = renderForm();
    await choose();
    expect(document.activeElement).toBe(button("Cancel upload"));
    await finish(refusal(415, "unsupported_image"));
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(status()).toBe(typeProblem);
  });

  it("keeps an empty description focused when a first file is refused", async () => {
    const finish = holdUpload();
    const { choose, user } = renderForm();
    await choose();
    await user.tab();
    const editor = describePicture();
    expect(document.activeElement).toBe(editor);
    await finish(refusal(415, "unsupported_image"));
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe("");
    expect(status()).toBe(typeProblem);
    await user.tab();
    expect(document.activeElement).toBe(button("Post"));
    expect(
      screen.queryByRole("textbox", { name: "Picture description" }),
    ).toBeNull();
  });

  it("keeps the retryable problem and description if a retry is cancelled", async () => {
    uploadPicture.mockRejectedValueOnce(new TypeError("Connection lost"));
    const finish = holdUpload();
    const { choose, user } = renderForm();
    await choose();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await user.type(describePicture(), "Still my draft");
    await user.click(button("Cancel upload"));
    expect(describedBy(button("Try again"))).toEqual([hint, network]);
    expect(describePicture().value).toBe("Still my draft");
    await finish();
    expect(button("Try again")).toBeTruthy();
  });

  it("clears an expired image, keeps its description and blocks Post until the description is cleared", async () => {
    const { ready, user, posted } = renderForm();
    await ready("x");
    await user.click(button("Simulate expired picture"));
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(describedBy(button("Choose a picture"))).toEqual([
      hint,
      "This picture is no longer available. Choose it again. Its description and the rest of your draft are kept.",
    ]);
    expect(describePicture().value).toBe("x");
    expect(screen.queryByText(/^Required with a picture\./)).toBeNull();
    await user.click(button("Post"));
    expect(document.activeElement).toBe(describePicture());
    expect(describedBy(describePicture())).toEqual([orphan]);
    expect(posted).not.toHaveBeenCalled();
    await user.keyboard("{End}{Backspace}");
    expect(
      screen.queryByRole("textbox", { name: "Picture description" }),
    ).toBeNull();
    expect(document.activeElement).toBe(button("Choose a picture"));
    await user.tab();
    await user.keyboard("{Enter}");
    expect(posted).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it.each(["upload", "Post"])(
    "hands signed_out from %s to the form and retains its draft through sign-in",
    async (source) => {
      const { choose, ready, user, posted } = renderForm();
      if (source === "upload") {
        const finish = holdUpload();
        await choose();
        await user.type(describePicture(), "Kept through sign-in");
        await finish(refusal(401, "signed_out"));
      } else {
        await ready("Kept through sign-in");
        await user.click(button("Simulate signed out"));
      }
      expect(screen.queryByRole("img")).toBeNull();
      await user.click(button("Sign in again"));
      expect(describePicture().value).toBe("Kept through sign-in");
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value,
      ).toBe("My draft");
      await user.click(button("Post"));
      expect(describedBy(describePicture())).toEqual([orphan]);
      expect(posted).not.toHaveBeenCalled();
      await choose();
      await screen.findByRole("button", { name: "Replace" });
      await user.click(button("Post"));
      expect(posted).toHaveBeenCalledExactlyOnceWith({
        id: firstId,
        alt: "Kept through sign-in",
      });
    },
  );

  it("aborts and releases the preview if the form unmounts during upload", async () => {
    const finish = holdUpload();
    const { choose, unmount } = renderForm();
    await choose();
    expect(uploadPicture).toHaveBeenCalled();
    unmount();
    expect(uploadPicture.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith("blob:playground.jpg");
    await finish();
  });
});
