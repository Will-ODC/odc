import { ApiError } from "../api/types.js";

export const PICTURE_TYPES = "image/jpeg,image/png,image/webp";
const megabyte = 1024 * 1024;

const unsupported =
  "Pulse cannot use this file. Choose a JPEG, PNG or WebP picture. GIF, SVG, HEIC and moving pictures are not accepted.";
const network =
  "The picture did not upload. Check your connection, then try again. Everything else you wrote is kept.";
const unavailableNow =
  "Pulse cannot take pictures right now. Try again later, or post without a picture. Everything else you wrote is kept.";

export function pictureSize(bytes: number): string {
  return `${(bytes / megabyte).toFixed(1)} MB`;
}

function sizeProblem(bytes: number): string {
  return `This picture is ${pictureSize(bytes)}. Choose one of 10 MB or less.`;
}

export function fileProblem(file: File): string | undefined {
  if (!PICTURE_TYPES.split(",").includes(file.type)) return unsupported;
  if (file.size > 10 * megabyte) return sizeProblem(file.size);
}

export async function measurePicture(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  } catch {
    // A decoder failure leaves the content and dimensions checks to the API.
    return undefined;
  }
}

export function dimensionsProblem(
  dimensions: Awaited<ReturnType<typeof measurePicture>>,
): string | undefined {
  if (!dimensions) return;
  const { width, height } = dimensions;
  const shorter = Math.min(width, height);
  const longer = Math.max(width, height);
  const area = width * height;
  const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  if (longer > 8000) {
    const side = width >= height ? "wide" : "tall";
    return `This picture is too large: ${format.format(longer)} pixels ${side}. Choose one up to 8,000 pixels on each side and 40 megapixels in all.`;
  }
  if (area > 40_000_000) {
    return `This picture is too large: ${format.format(area / 1_000_000)} megapixels. Choose one up to 40 megapixels and 8,000 pixels on each side.`;
  }
  if (shorter < 200) {
    return `This picture is too small: ${shorter} pixels on its shorter side. Choose one at least 200 pixels on each side.`;
  }
}

export function uploadProblem(
  error: unknown,
  file: File,
  dimensions: Awaited<ReturnType<typeof measurePicture>>,
): { message: string; retry?: true } {
  switch (error instanceof ApiError ? error.code : undefined) {
    case "unsupported_image":
      return { message: unsupported };
    case "image_too_large":
      return { message: sizeProblem(file.size) };
    case "image_dimensions":
      return {
        message:
          dimensionsProblem(dimensions) ??
          "This picture is too small or too large. Choose a different picture.",
      };
    case "image_busy":
      return {
        message:
          "Pulse is busy with other pictures. Try again in a minute. Everything else you wrote is kept.",
        retry: true,
      };
    case "images_unavailable":
    case "too_many_requests":
      return { message: unavailableNow, retry: true };
    case "upload_limit": {
      const seconds = (error as ApiError).retryAfter;
      const minutes = Math.ceil((seconds ?? 0) / 60);
      const wait =
        Number.isSafeInteger(minutes) && minutes > 0
          ? `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
          : "later";
      return {
        message: `You have uploaded 20 pictures in the last hour, the most allowed. Try again ${wait}, or post without a picture.`,
      };
    }
    case "pending_limit":
      return {
        message:
          "You have 5 pictures that are not posted yet, the most allowed at once. Unposted pictures clear after a day. Try again tomorrow, or post without a picture.",
      };
    default:
      return { message: network, retry: true };
  }
}
