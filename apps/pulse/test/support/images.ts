import { deflateSync } from "node:zlib";
import sharp from "sharp";

/**
 * Small picture fixtures, generated in the test so no binary file is
 * committed. Each is built to exercise one rule of ADR-0047 section 3.
 */

/** A plain solid picture of this size, in one of the accepted formats. */
export async function picture(
  format: "jpeg" | "png" | "webp",
  width = 400,
  height = 300,
): Promise<Buffer> {
  return solid(width, height)[format]().toBuffer();
}

function solid(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 60, b: 40 },
    },
  });
}

/** Text that only this fixture's metadata carries, to search stored bytes for. */
export const LEAKY_MAKE = "LeakyCamMake";
export const LEAKY_XMP = "XmpSecretAuthor";

/**
 * A 400 x 300 JPEG carrying everything the server must drop: EXIF with a
 * camera make and a GPS location (IFD3), orientation 6 (rotate 90 degrees),
 * XMP naming an author, and a Display P3 ICC profile.
 */
export async function jpegWithMetadata(): Promise<Buffer> {
  return solid(400, 300)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: LEAKY_MAKE },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "49/1 15/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "123/1 7/1 0/1",
      },
    })
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<dc:creator>${LEAKY_XMP}</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`,
    )
    .withIccProfile("p3")
    .toBuffer();
}

/** Does this EXIF block hold a GPS IFD pointer (tag 0x8825), either byte order? */
export function hasGpsPointer(exif: Buffer): boolean {
  return (
    exif.includes(Buffer.from([0x88, 0x25])) ||
    exif.includes(Buffer.from([0x25, 0x88]))
  );
}

/** An animated WebP of two 200 x 200 frames. */
export async function animatedWebp(): Promise<Buffer> {
  const frames = await Promise.all(
    ["red", "blue"].map((background) =>
      sharp({ create: { width: 200, height: 200, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(frames, { join: { animated: true } })
    .webp()
    .toBuffer();
}

/**
 * An animated PNG: a real 300 x 300 PNG with an `acTL` chunk placed before
 * its first `IDAT`, which is what makes a PNG an APNG.
 */
export async function animatedPng(): Promise<Buffer> {
  const png = await picture("png", 300, 300);
  // Signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 CRC).
  const afterHeader = 8 + 25;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(1, 0); // frames
  actl.writeUInt32BE(0, 4); // plays
  return Buffer.concat([
    png.subarray(0, afterHeader),
    chunk("acTL", actl),
    png.subarray(afterHeader),
  ]);
}

/**
 * A still PNG carrying an `acTL` chunk only after its image data, just before
 * `IEND`. Not an APNG by the rule (acTL before the first IDAT), so accepted.
 */
export async function pngWithLateActl(): Promise<Buffer> {
  const png = await picture("png", 300, 300);
  const iend = png.length - 12;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(1, 0);
  return Buffer.concat([
    png.subarray(0, iend),
    chunk("acTL", actl),
    png.subarray(iend),
  ]);
}

/**
 * A PNG whose header claims this size, with a token image body. Enough for
 * any check that reads the header only, and nothing that decodes it, so the
 * size refusals can be tested without making a 40-megapixel picture.
 */
export function pngClaimingSize(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Formats that are refused, each as real bytes. */
export async function gif(): Promise<Buffer> {
  return solid(300, 300).gif().toBuffer();
}
export async function avif(): Promise<Buffer> {
  return solid(300, 300).avif().toBuffer();
}
export function svg(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
      '<script>alert(1)</script><rect width="300" height="300"/></svg>',
  );
}
/** The start of a HEIC file: an ISO-BMFF `ftyp` box with the `heic` brand. */
export function heic(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "latin1");
  box.write("mif1heic", 16, "latin1");
  return Buffer.concat([box, Buffer.alloc(512)]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
