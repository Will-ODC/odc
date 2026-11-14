import { createHash } from "node:crypto";
import type { Metadata } from "sharp";
import type sharpModule from "sharp";
import {
  DISPLAY_QUALITY,
  DISPLAY_SIZE,
  MAX_INPUT_PIXELS,
  MAX_INPUT_SIDE,
  MIN_INPUT_SIDE,
  THUMB_QUALITY,
  THUMB_SIZE,
} from "./limits.js";

type Sharp = typeof sharpModule;

/**
 * sharp (libvips) is loaded on the first upload, not at startup: a process
 * that never handles a picture never loads the native library.
 */
let loaded: Promise<Sharp> | undefined;
function loadSharp(): Promise<Sharp> {
  loaded ??= import("sharp").then(({ default: sharp }) => {
    // No libvips operation cache: every upload is different, and a cache
    // only keeps decoded pictures in memory after they are stored.
    sharp.cache(false);
    return sharp;
  });
  return loaded;
}

/** Why an upload was refused. The route turns each into its own answer. */
export class ImageRefusal extends Error {
  constructor(
    readonly code: "unsupported_image" | "image_dimensions" | "image_busy",
  ) {
    super(code);
    this.name = "ImageRefusal";
  }
}

/** One stored variant: re-encoded WebP and the SHA-256 of exactly those bytes. */
export interface EncodedVariant {
  bytes: Buffer;
  sha256: string;
}

/** What the server keeps of an upload. The original bytes are not in it. */
export interface ProcessedImage {
  /** Size of the display variant. */
  width: number;
  height: number;
  display: EncodedVariant;
  thumb: EncodedVariant;
}

export type SniffedFormat = "jpeg" | "png" | "webp";

/**
 * The format, from the file's own first bytes, never its declared type or
 * name. Anything other than JPEG, PNG or WebP — SVG, GIF, HEIC, AVIF, TIFF,
 * text — is undefined.
 */
export function sniff(input: Buffer): SniffedFormat | undefined {
  if (
    input.length >= 3 &&
    input[0] === 0xff &&
    input[1] === 0xd8 &&
    input[2] === 0xff
  )
    return "jpeg";
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (
    input.length >= 12 &&
    input.toString("latin1", 0, 4) === "RIFF" &&
    input.toString("latin1", 8, 12) === "WEBP"
  )
    return "webp";
  return undefined;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Is this PNG animated (APNG)? It is when an `acTL` chunk appears before the
 * first `IDAT` (ADR-0047 section 3). A chunk walk over the upload, no decoder:
 * libvips would quietly load the first frame, and an animated file is refused,
 * never cut to its first frame. A chunk list that runs past the end of the
 * file is refused too, since nothing honest produces one.
 */
export function isAnimatedPng(input: Buffer): boolean {
  let at = 8;
  while (at + 8 <= input.length) {
    const length = input.readUInt32BE(at);
    const type = input.toString("latin1", at + 4, at + 8);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    at += 12 + length;
  }
  throw new ImageRefusal("unsupported_image");
}

/**
 * Turn an upload into the two stored WebP variants, or refuse it.
 *
 * The format is sniffed from the bytes, then confirmed by libvips's own
 * reading of the header; the two must agree. Size limits are checked from the
 * header before any full decode. The picture is rotated by its EXIF
 * orientation and re-encoded; sharp writes no metadata unless asked to, so
 * EXIF (with GPS location), XMP, IPTC and the ICC profile are all dropped,
 * and colour is converted to sRGB. That is the privacy guarantee: no
 * location or camera data leaves the server.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const format = sniff(input);
  if (format === undefined) throw new ImageRefusal("unsupported_image");
  if (format === "png" && isAnimatedPng(input))
    throw new ImageRefusal("unsupported_image");

  const sharp = await loadSharp();
  let header: Metadata;
  try {
    // The header only: no pixel limit here, so an oversized picture is told
    // apart from an unreadable one below.
    header = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageRefusal("unsupported_image");
  }
  if (header.format !== format) throw new ImageRefusal("unsupported_image");
  if ((header.pages ?? 1) > 1) throw new ImageRefusal("unsupported_image");
  const { width, height } = header;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new ImageRefusal("unsupported_image");
  if (
    width > MAX_INPUT_SIDE ||
    height > MAX_INPUT_SIDE ||
    width * height > MAX_INPUT_PIXELS ||
    Math.min(width, height) < MIN_INPUT_SIDE
  )
    throw new ImageRefusal("image_dimensions");

  try {
    const base = sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    }).autoOrient();
    const display = await base
      .clone()
      .resize({
        width: DISPLAY_SIZE,
        height: DISPLAY_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: DISPLAY_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base
      .clone()
      .resize({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    return {
      width: display.info.width,
      height: display.info.height,
      display: encoded(display.data),
      thumb: encoded(thumb),
    };
  } catch {
    // A truncated or corrupt file. Not a fault in pulse, so not logged.
    throw new ImageRefusal("unsupported_image");
  }
}

function encoded(bytes: Buffer): EncodedVariant {
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * One decode at a time per instance, and a short queue behind it (ADR-0047
 * section 3). A full queue refuses at once with `image_busy`, so picture
 * processing can never slow votes down by piling up.
 */
export class DecodeQueue {
  readonly #maxWaiting: number;
  #running = false;
  readonly #waiting: (() => void)[] = [];

  constructor(maxWaiting = 4) {
    this.#maxWaiting = maxWaiting;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running) {
      if (this.#waiting.length >= this.#maxWaiting)
        throw new ImageRefusal("image_busy");
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#running = true;
    try {
      return await work();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#running = false;
    }
  }
}

/** What the upload route calls. Tests may pass their own. */
export type ImageProcessor = (input: Buffer) => Promise<ProcessedImage>;
