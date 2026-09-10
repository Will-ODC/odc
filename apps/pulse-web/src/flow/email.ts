/**
 * Is this worth sending to the server?
 *
 * Deliberately looser than `apps/pulse/src/identity/email.ts`, which is the
 * authority and stays it. This one catches only what a person can see is wrong
 * the moment it is pointed at — no @, nothing before it, nothing after it, a
 * domain with no dot — so that an obvious typo costs a glance rather than a
 * round trip.
 *
 * The failure to avoid here is the opposite one: a client rule stricter than
 * the server's rejects addresses that would have worked, and the person has no
 * way to argue with it. When in doubt, let it through and let the server
 * answer.
 */
const MAX_LENGTH = 254; // RFC 5321, same as the server

export function looksLikeEmail(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return false;
  if (/\s/.test(trimmed)) return false;

  // Last @, matching the server: the local part may legally contain one.
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return false;

  const domain = trimmed.slice(at + 1);
  // A dot with a label either side. `student.ubc.ca` passes, `ubc` does not —
  // and a bare hostname is the typo this check is really for.
  return /^[^.]+(\.[^.]+)+$/.test(domain);
}
