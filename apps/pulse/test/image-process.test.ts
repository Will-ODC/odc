import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import {
  DecodeQueue,
  ImageRefusal,
  isAnimatedPng,
  processImage,
  sniff,
} from "../src/images/process.js";
import {
  LEAKY_MAKE,
  LEAKY_XMP,
  animatedPng,
  animatedWebp,
  avif,
  gif,
  hasGpsPointer,
  heic,
  jpegWithMetadata,
  picture,
  pngClaimingSize,
  svg,
} from "./support/images.js";

async function refusedAs(input: Buffer, code: ImageRefusal["code"]) {
  await assert.rejects(
    processImage(input),
    (error: unknown) => error instanceof ImageRefusal && error.code === code,
  );
}

test("sniffs_jpeg_png_and_webp_by_their_bytes_and_nothing_else", async () => {
  assert.equal(sniff(await picture("jpeg")), "jpeg");
  assert.equal(sniff(await picture("png")), "png");
  assert.equal(sniff(await picture("webp")), "webp");
  for (const other of [
    await gif(),
    await avif(),
    svg(),
    heic(),
    Buffer.alloc(0),
  ])
    assert.equal(sniff(other), undefined);
});

test("strips_exif_gps_xmp_and_icc_from_both_stored_variants", async () => {
  const input = await jpegWithMetadata();
  // The fixture really carries what must go.
  const before = await sharp(input).metadata();
  assert.ok(before.exif && hasGpsPointer(before.exif));
  assert.ok(before.xmp);
  assert.ok(before.icc);
  assert.ok(input.includes(LEAKY_MAKE) && input.includes(LEAKY_XMP));

  const out = await processImage(input);
  for (const variant of [out.display, out.thumb]) {
    const meta = await sharp(variant.bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined);
    assert.equal(meta.xmp, undefined);
    assert.equal(meta.icc, undefined);
    assert.equal(meta.iptc, undefined);
    assert.equal(variant.bytes.includes("Exif"), false);
    assert.equal(variant.bytes.includes(LEAKY_MAKE), false);
    assert.equal(variant.bytes.includes(LEAKY_XMP), false);
    assert.equal(variant.bytes.includes("XMP "), false);
    assert.equal(variant.bytes.includes("ICCP"), false);
  }
});

test("rotates_by_exif_orientation_before_dropping_it", async () => {
  // 400 x 300 with orientation 6 is a 300 x 400 picture.
  const out = await processImage(await jpegWithMetadata());
  assert.deepEqual([out.width, out.height], [300, 400]);
});

test("display_fits_1600_keeping_aspect_and_thumb_is_a_256_square", async () => {
  const out = await processImage(await picture("png", 3200, 1000));
  assert.deepEqual([out.width, out.height], [1600, 500]);
  const display = await sharp(out.display.bytes).metadata();
  assert.deepEqual([display.width, display.height], [1600, 500]);
  const thumb = await sharp(out.thumb.bytes).metadata();
  assert.deepEqual([thumb.width, thumb.height], [256, 256]);
});

test("a_small_picture_is_not_enlarged", async () => {
  const out = await processImage(await picture("webp", 300, 200));
  assert.deepEqual([out.width, out.height], [300, 200]);
});

test("each_variant_hash_is_the_sha256_of_its_stored_bytes", async () => {
  const out = await processImage(await picture("jpeg"));
  for (const variant of [out.display, out.thumb])
    assert.equal(
      variant.sha256,
      createHash("sha256").update(variant.bytes).digest("hex"),
    );
});

test("refuses_svg_gif_heic_avif_and_text_as_unsupported", async () => {
  for (const input of [svg(), await gif(), heic(), await avif()])
    await refusedAs(input, "unsupported_image");
  await refusedAs(Buffer.from("hello"), "unsupported_image");
  await refusedAs(Buffer.alloc(0), "unsupported_image");
});

test("refuses_an_animated_png_whose_actl_comes_before_idat", async () => {
  const apng = await animatedPng();
  assert.equal(isAnimatedPng(apng), true);
  assert.equal(isAnimatedPng(await picture("png")), false);
  await refusedAs(apng, "unsupported_image");
});

test("refuses_a_multi_page_webp_rather_than_keeping_its_first_frame", async () => {
  const animated = await animatedWebp();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await refusedAs(animated, "unsupported_image");
});

test("refuses_a_png_whose_chunks_run_past_the_end", async () => {
  const png = await picture("png");
  await refusedAs(png.subarray(0, 20), "unsupported_image");
});

test("refuses_a_truncated_jpeg_as_unsupported", async () => {
  const jpeg = await picture("jpeg");
  await refusedAs(
    jpeg.subarray(0, Math.floor(jpeg.length / 2)),
    "unsupported_image",
  );
});

test("refuses_a_file_whose_bytes_and_header_disagree", async () => {
  // JPEG magic in front of PNG bytes: the sniff says JPEG, libvips cannot read it.
  const png = await picture("png");
  await refusedAs(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]),
    "unsupported_image",
  );
});

test("size_limits_are_read_from_the_header_before_any_decode", async () => {
  // Each header claims a size the token body could never hold: refused as
  // too big or too small, never as unreadable, so no decode was attempted.
  await refusedAs(pngClaimingSize(8001, 300), "image_dimensions");
  await refusedAs(pngClaimingSize(300, 8001), "image_dimensions");
  await refusedAs(pngClaimingSize(7000, 6000), "image_dimensions"); // 42 MP
  await refusedAs(pngClaimingSize(199, 4000), "image_dimensions");
  await refusedAs(await picture("png", 199, 300), "image_dimensions");
});

test("accepts_the_exact_limits", async () => {
  const out = await processImage(await picture("png", 200, 200));
  assert.deepEqual([out.width, out.height], [200, 200]);
});

test("the_decode_queue_runs_one_at_a_time_and_refuses_when_full", async () => {
  const queue = new DecodeQueue(1);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const first = queue.run(async () => {
    order.push("first");
    await held;
    return 1;
  });
  const second = queue.run(async () => {
    order.push("second");
    return 2;
  });
  await assert.rejects(
    queue.run(async () => 3),
    (error: unknown) =>
      error instanceof ImageRefusal && error.code === "image_busy",
  );
  assert.deepEqual(order, ["first"]);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first", "second"]);
  // Free again afterwards.
  assert.equal(await queue.run(async () => 4), 4);
});

test("a_failed_decode_frees_the_queue", async () => {
  const queue = new DecodeQueue(0);
  await assert.rejects(queue.run(async () => Promise.reject(new Error("x"))));
  assert.equal(await queue.run(async () => 5), 5);
});
