import { parseEmail } from "../identity/email.js";

/**
 * The owner address from `PULSE_OWNER_EMAIL`, normalised, or none (ADR-0037).
 *
 * Optional in every entry point: a deployment without an owner is complete,
 * it simply has nobody who can grant unlimited posting. Unset or blank means
 * none. Anything set that is not an address refuses the start, because
 * silently running with no owner would look exactly like a working
 * configuration until the owner tried to use it. The value is not repeated in
 * the message: it is somebody's address.
 */
export function ownerEmail(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.PULSE_OWNER_EMAIL?.trim();
  if (raw === undefined || raw === "") return undefined;
  try {
    return parseEmail(raw).value;
  } catch {
    throw new Error(
      "PULSE_OWNER_EMAIL is set but is not an email address; " +
        "set it to the owner's address or leave it unset for no owner",
    );
  }
}
