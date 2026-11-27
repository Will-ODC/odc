import { z } from "zod";
import { IMAGE_ID, MAX_ALT_LENGTH } from "./limits.js";

export const pictureInput = z
  .object({
    id: z.string().regex(IMAGE_ID),
    alt: z
      .string()
      .trim()
      .min(1)
      .refine(
        (alt) =>
          [...alt].length <= MAX_ALT_LENGTH &&
          !alt.includes("\0") &&
          !/[\uD800-\uDFFF]/u.test(alt),
      ),
  })
  .strict();

export type PictureInput = z.infer<typeof pictureInput>;

export const pictureRemovalQuery = z.object({
  expectedImageId: pictureInput.shape.id.optional(),
});
