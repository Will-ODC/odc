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
import { HttpPulseApi } from "../src/api/http.js";
import { PictureField } from "../src/components/PictureField.js";
import { usePictureField } from "../src/hooks/use-picture-field.js";

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
const fetchUpload = vi.fn<typeof fetch>();
const bitmap = vi.fn<typeof createImageBitmap>();
const closeBitmap = vi.fn();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
const client = new HttpPulseApi("/api", fetchUpload);
const describePicture = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Picture description",
  });
const button = (name: string) => screen.getByRole("button", { name });
const status = () => screen.getByRole("status").textContent;

function success(id = firstId) {
  return Response.json(
    { image: { id, width: 800, height: 600 } },
    { status: 201 },
  );
}

function refusal(status: number, error: string, retryAfter?: string) {
  return Response.json(
    { error, message: "Server wording" },
    {
      status,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    },
  );
}

function holdUpload() {
  let finish!: (response: Response) => void;
  fetchUpload.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  return async (response = success()) => {
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => finish(response));
  };
}

function renderForm() {
  const posted = vi.fn();
  function Form() {
    const [signedOut, setSignedOut] = useState(false);
    const field = usePictureField(() => setSignedOut(true), client);
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
  const view = render(<Form />);
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
  fetchUpload.mockReset().mockImplementation(async () => success());
  bitmap.mockReset().mockResolvedValue({
    width: 800,
    height: 600,
    close: closeBitmap,
  } as ImageBitmap);
  closeBitmap.mockClear();
  createUrl.mockReset().mockImplementation((file: File) => `blob:${file.name}`);
  revokeUrl.mockClear();
  vi.stubGlobal("createImageBitmap", bitmap);
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
    expect(fetchUpload).not.toHaveBeenCalled();
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
    expect(fetchUpload).toHaveBeenCalledExactlyOnceWith("/api/poll-images", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "image/jpeg" },
      signal: expect.any(AbortSignal),
      body: photo,
    });
  });

  it("requires a non-blank description and counts trimmed Unicode code points", async () => {
    const { ready, user, posted } = renderForm();
    await ready("   ");
    await user.click(button("Post"));
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
    fetchUpload.mockImplementationOnce(async () => success(secondId));
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
    await waitFor(() => expect(fetchUpload).toHaveBeenCalled());
    const signal = fetchUpload.mock.calls[0]?.[1]?.signal;
    await user.type(describePicture(), "Unfinished description");
    await user.click(button("Cancel upload"));
    expect(signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Picture description" }),
    ).toBeNull();
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
        expect(fetchUpload).toHaveBeenCalledTimes(1);
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
      expect(bitmap).not.toHaveBeenCalled();
      expect(fetchUpload).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      150,
      300,
      "This picture is too small: 150 pixels on its shorter side. Choose one at least 200 pixels on each side.",
    ],
    [
      9600,
      300,
      "This picture is too large: 9,600 pixels wide. Choose one up to 8,000 pixels on each side and 40 megapixels in all.",
    ],
    [
      300,
      9600,
      "This picture is too large: 9,600 pixels tall. Choose one up to 8,000 pixels on each side and 40 megapixels in all.",
    ],
    [
      7000,
      7000,
      "This picture is too large: 49 megapixels. Choose one up to 40 megapixels and 8,000 pixels on each side.",
    ],
  ])("refuses a %i × %i picture locally", async (width, height, message) => {
    bitmap.mockResolvedValueOnce({
      width,
      height,
      close: closeBitmap,
    } as ImageBitmap);
    const { choose } = renderForm();
    await choose();
    expect(describedBy(button("Choose a picture"))).toEqual([hint, message]);
    expect(closeBitmap).toHaveBeenCalledOnce();
    expect(fetchUpload).not.toHaveBeenCalled();
  });

  it("accepts exactly 10 MiB, a 200 pixel short side, and an 8,000 pixel side at 40 megapixels", async () => {
    bitmap.mockResolvedValueOnce({
      width: 200,
      height: 8000,
      close: closeBitmap,
    } as ImageBitmap);
    bitmap.mockResolvedValueOnce({
      width: 5000,
      height: 8000,
      close: closeBitmap,
    } as ImageBitmap);
    const { choose } = renderForm();
    await choose(
      new File([new Uint8Array(10_485_760)], "boundary.webp", {
        type: "image/webp",
      }),
    );
    await screen.findByRole("button", { name: "Replace" });
    await choose(replacement);
    await waitFor(() => expect(status()).toMatch(/^Picture replaced/));
    expect(fetchUpload).toHaveBeenCalledTimes(2);
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
      "61",
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
      bitmap.mockRejectedValueOnce(new Error("Decoder unavailable"));
      fetchUpload.mockResolvedValueOnce(refusal(code, slug, header));
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
    [201, "malformed success", network],
  ])(
    "keeps the file and draft after %i %s, and retries the same file",
    async (code, slug, message) => {
      const { choose, user, posted } = renderForm();
      if (code === 0)
        fetchUpload.mockRejectedValueOnce(new TypeError("Connection lost"));
      else if (code === 201)
        fetchUpload.mockResolvedValueOnce(
          Response.json({ image: {} }, { status: 201 }),
        );
      else fetchUpload.mockResolvedValueOnce(refusal(code, slug));
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
      expect(
        fetchUpload.mock.calls.map(([, options]) => options?.body),
      ).toEqual([photo, photo]);
      expect(describePicture().value).toBe("Kept draft");
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value,
      ).toBe("My draft");
    },
  );

  it("keeps the retryable problem and description if a retry is cancelled", async () => {
    fetchUpload.mockRejectedValueOnce(new TypeError("Connection lost"));
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
    await ready("Keep this description");
    await user.click(button("Simulate expired picture"));
    expect(document.activeElement).toBe(button("Choose a picture"));
    expect(describedBy(button("Choose a picture"))).toEqual([
      hint,
      "This picture is no longer available. Choose it again. Its description and the rest of your draft are kept.",
    ]);
    expect(describePicture().value).toBe("Keep this description");
    await user.click(button("Post"));
    expect(document.activeElement).toBe(describePicture());
    expect(describedBy(describePicture())[1]).toBe(orphan);
    expect(posted).not.toHaveBeenCalled();
    await user.clear(describePicture());
    await user.click(button("Post"));
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
      expect(describedBy(describePicture())[1]).toBe(orphan);
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
    await waitFor(() => expect(fetchUpload).toHaveBeenCalled());
    unmount();
    expect(fetchUpload.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith("blob:playground.jpg");
    await finish();
  });
});
