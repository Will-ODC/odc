import { ApiError } from "../api/types.js";

export const PICTURE_TYPES = "image/jpeg,image/png,image/webp";
const megabyte = 1024 * 1024;
const headerLimit = 64 * 1024;
type Dimensions = { width: number; height: number };

const unsupported =
  "Pulse cannot use this file. Choose a JPEG, PNG or WebP picture. GIF, SVG, HEIC and moving pictures are not accepted.";
const network =
  "The picture did not upload. Check your connection, then try again. Everything else you wrote is kept.";
const unavailableNow =
  "Pulse cannot take pictures right now. Try again later, or post without a picture. Everything else you wrote is kept.";

export function pictureSize(bytes: number): string {
  if (bytes < megabyte) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / megabyte).toFixed(1)} MB`;
}

function sizeProblem(bytes: number): string {
  return `This picture is ${pictureSize(bytes)}. Choose one of 10 MB or less.`;
}

export function fileProblem(file: File): string | undefined {
  if (!PICTURE_TYPES.split(",").includes(file.type)) return unsupported;
  if (file.size > 10 * megabyte) return sizeProblem(file.size);
}

function jpegDimensions(data: DataView): Dimensions | undefined {
  // Skip length-prefixed segments (including EXIF) until a Start of Frame.
  let offset = 2;
  while (offset < data.byteLength && data.getUint8(offset) === 0xff) {
    do {
      offset++;
    } while (offset < data.byteLength && data.getUint8(offset) === 0xff);
    if (offset === data.byteLength) return;
    const marker = data.getUint8(offset++);
    if (marker === 0x01) continue; // TEM has no segment length.
    if (marker < 0xc0 || (marker >= 0xd0 && marker <= 0xda)) return;
    if (offset + 2 > data.byteLength) return;
    const length = data.getUint16(offset);
    if (length < 2 || offset + length > data.byteLength) return;

    const isFrame =
      marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 11) return;
      return {
        width: data.getUint16(offset + 5),
        height: data.getUint16(offset + 3),
      };
    }
    offset += length;
  }
}

function webpDimensions(data: DataView): Dimensions | undefined {
  if (data.byteLength < 20 || data.getUint32(8) !== 0x57454250) return;
  const chunkSize = data.getUint32(16, true);
  // Each supported layout puts its image or canvas header in the first chunk.
  switch (data.getUint32(12)) {
    case 0x56503820: // VP8: key-frame signature, then two 14-bit dimensions.
      if (
        chunkSize < 10 ||
        data.byteLength < 30 ||
        (data.getUint8(20) & 1) !== 0 ||
        data.getUint16(23) !== 0x9d01 ||
        data.getUint8(25) !== 0x2a
      )
        return;
      return {
        width: data.getUint16(26, true) & 0x3fff,
        height: data.getUint16(28, true) & 0x3fff,
      };
    case 0x5650384c: {
      // VP8L: signature, then two packed 14-bit values.
      if (chunkSize < 5 || data.byteLength < 25 || data.getUint8(20) !== 0x2f)
        return;
      const packed = data.getUint32(21, true);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
    }
    case 0x56503858: // VP8X: two little-endian 24-bit canvas values.
      if (chunkSize !== 10 || data.byteLength < 30) return;
      return {
        width: (data.getUint32(23, true) >>> 8) + 1,
        height: (data.getUint32(26, true) >>> 8) + 1,
      };
  }
}

function headerDimensions(data: DataView): Dimensions | undefined {
  if (data.byteLength < 2) return;
  if (data.getUint16(0) === 0xffd8) return jpegDimensions(data);
  if (data.byteLength < 4) return;
  if (data.getUint32(0) === 0x52494646) return webpDimensions(data); // RIFF
  if (
    data.byteLength >= 33 &&
    data.getUint32(0) === 0x89504e47 &&
    data.getUint32(4) === 0x0d0a1a0a &&
    data.getUint32(8) === 13 &&
    data.getUint32(12) === 0x49484452 // IHDR
  ) {
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
}

export async function measurePicture(
  file: File,
): Promise<Dimensions | undefined> {
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file.slice(0, headerLimit));
    });
    const dimensions = headerDimensions(new DataView(bytes));
    if (dimensions && dimensions.width > 0 && dimensions.height > 0)
      return dimensions;
  } catch {
    // A missing or unreadable header leaves the generic server refusal copy.
  }
}

function dimensionsProblem(
  dimensions: Dimensions | undefined,
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
  dimensions: Dimensions | undefined,
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
