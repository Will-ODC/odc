/**
 * The profile editor's field rules, in the editor's own words.
 *
 * The display-name rule repeats the server's (`normalizeProfile` in
 * `apps/pulse/src/profiles/input.ts`) so the editor can say what is wrong
 * before saving instead of showing a refusal it cannot explain. The parity
 * test in `tests/pulse-integration` keeps the two identical.
 *
 * A name needs at least one character people can see. It may not contain
 * control or format characters — which covers the bidi overrides and isolates
 * that can make a name read as something else — except the zero-width joiner
 * and non-joiner (U+200D, U+200C), which emoji sequences and Persian and Indic
 * names need.
 */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
const HIDDEN = /(?![‌‍])[\p{Cc}\p{Cf}]/u;

export const NAME_LIMIT = 80;
export const BIO_LIMIT = 280;

export function nameProblem(value: string): string | undefined {
  const name = value.trim();
  if (name === "") return "Enter a display name.";
  if (!VISIBLE.test(name)) return "Enter a name people can see.";
  if (HIDDEN.test(name))
    return "Remove the hidden formatting characters from the name.";
  if ([...name].length > NAME_LIMIT)
    return `Use ${NAME_LIMIT} characters or fewer.`;
  return undefined;
}

export function bioProblem(value: string): string | undefined {
  if ([...value.trim()].length > BIO_LIMIT)
    return `Use ${BIO_LIMIT} characters or fewer.`;
  return undefined;
}
