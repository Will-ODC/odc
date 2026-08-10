/**
 * Email address handling for pulse.
 *
 * Two jobs, kept separate on purpose: deciding whether an address is usable at
 * all, and reducing it to the form we store and compare. Everything downstream
 * — the domain allowlist, one-claim-per-person — compares normalized addresses,
 * so normalization has to be the single place that decides what "the same
 * person" means.
 */

/** A validated, normalized address. Carry this, not a bare string. */
export interface EmailAddress {
  /** Lowercased `local@domain`, the form stored and compared. */
  readonly value: string;
  /** Lowercased domain part, no leading dot. */
  readonly domain: string;
}

export class InvalidEmailError extends Error {
  constructor(address: string, why: string) {
    super(`not a usable email address (${why}): ${address}`);
    this.name = "InvalidEmailError";
  }
}

/**
 * Deliberately stricter than RFC 5322 and deliberately not a one-line regex.
 * The full grammar allows quoted strings, comments, and address literals that
 * no student or resident is going to type; accepting them would only widen what
 * the allowlist has to reason about. Anything rejected here is an address a
 * person can retype in a normal form.
 */
const MAX_LENGTH = 254; // RFC 5321 limit on the whole address
const MAX_LOCAL = 64;
const LOCAL_PART =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function parseEmail(input: string): EmailAddress {
  const trimmed = input.trim();
  if (trimmed === "") throw new InvalidEmailError(input, "empty");
  if (trimmed.length > MAX_LENGTH)
    throw new InvalidEmailError(input, "too long");

  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new InvalidEmailError(
      input,
      "needs one local part and one domain, separated by @",
    );
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();

  if (local.length > MAX_LOCAL)
    throw new InvalidEmailError(input, "local part too long");
  if (!LOCAL_PART.test(local))
    throw new InvalidEmailError(input, "unusable characters before the @");
  assertUsableDomain(input, domain);

  return { value: `${local.toLowerCase()}@${domain}`, domain };
}

/** True when `input` parses; use when a caller wants a boolean, not an error. */
export function isValidEmail(input: string): boolean {
  try {
    parseEmail(input);
    return true;
  } catch {
    return false;
  }
}

function assertUsableDomain(original: string, domain: string): void {
  const labels = domain.split(".");
  if (labels.length < 2) {
    throw new InvalidEmailError(original, "domain needs at least one dot");
  }
  for (const label of labels) {
    if (label === "")
      throw new InvalidEmailError(original, "empty part in the domain");
    if (label.length > 63)
      throw new InvalidEmailError(original, "domain part too long");
    if (!DOMAIN_LABEL.test(label)) {
      throw new InvalidEmailError(
        original,
        "unusable characters in the domain",
      );
    }
  }
  // A bare number as the last label means an IP-address literal, not a domain.
  if (/^\d+$/.test(labels[labels.length - 1] as string)) {
    throw new InvalidEmailError(
      original,
      "domain must end in a name, not a number",
    );
  }
}
