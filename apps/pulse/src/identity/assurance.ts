/**
 * How sure pulse is about who a voter is — the levels of sign-in decided
 * 2026-09-12 (docs/plans/pulse.md, P8 decision 1; ADR-0033).
 *
 * **Stored as words, ordered here.** The database holds `voter.assurance` as
 * plain text and knows nothing of the order, exactly as `polls.method` holds a
 * vote method (ADR-0021). So `in_person` and `scan` are added later by adding
 * them to this list in the right place — a code change, never a migration.
 *
 *   * `none`  — nobody vouches for this voter at all (an anonymous voter).
 *   * `link`  — they arrived through a public link; nothing proves who they are.
 *   * `email` — they clicked a link mailed to an address, so they hold it.
 *
 * Every voter this slice creates is `email`. Nothing yet creates the other two.
 */
export const ASSURANCE_LEVELS = ["none", "link", "email"] as const;

export type Assurance = (typeof ASSURANCE_LEVELS)[number];

/**
 * The kinds of credential a voter can hold — a `voter_credential.kind`.
 *
 * Not a third vocabulary beside the levels above: **a credential's kind is the
 * assurance word it confers.** Holding an `email` credential is what makes a
 * voter `email`. `none` and `link` are levels with no credential behind them,
 * which is why they are not kinds. A later `in_person` or `scan` is both a
 * level and a kind, with `voter_credential.params` holding who vouched.
 */
export type CredentialKind = Exclude<Assurance, "none" | "link">;

export function isAssurance(word: string): word is Assurance {
  return (ASSURANCE_LEVELS as readonly string[]).includes(word);
}

/**
 * Read a stored level back. A word this build does not know is refused rather
 * than guessed at: reading it as `none` would quietly demote someone, and as
 * anything higher would quietly promote them.
 */
export function parseAssurance(word: string): Assurance {
  if (!isAssurance(word)) {
    throw new Error(`unknown assurance level: ${JSON.stringify(word)}`);
  }
  return word;
}

/** Negative, zero or positive as `a` is below, level with, or above `b`. */
export function compareAssurance(a: Assurance, b: Assurance): number {
  return ASSURANCE_LEVELS.indexOf(a) - ASSURANCE_LEVELS.indexOf(b);
}

/** Whether `level` meets `required` — the check a gated poll will make. */
export function meetsAssurance(level: Assurance, required: Assurance): boolean {
  return compareAssurance(level, required) >= 0;
}

/** The level a credential of this kind confers. */
export function assuranceOf(kind: CredentialKind): Assurance {
  return kind;
}
