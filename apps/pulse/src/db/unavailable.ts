/**
 * Is this error the database being unreachable or briefly unable to serve,
 * rather than a fault in pulse?
 *
 * The distinction decides a status: an outage is a 503 the caller can retry
 * with the same request, a fault is a 500 somebody must look at. Each answer
 * here is one where the transaction that hit it committed nothing, so a retry
 * is safe.
 *
 * - Node network failures: the server is down, unreachable or dropped us.
 * - SQLSTATE class 08 (connection exception), 53 (insufficient resources,
 *   including too many connections), 57P01–57P03 (shutting down, or not
 *   accepting connections yet), and 40001/40P01 (a serialisation failure or
 *   deadlock the database itself resolved by rolling back).
 * - The pg driver's own wording for a connection that died or never came:
 *   it reports these as plain `Error`s with no code.
 */
export function isStorageUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    if (NETWORK_CODES.has(code)) return true;
    if (/^(08|53)[0-9A-Z]{3}$/.test(code)) return true;
    if (TRANSIENT_SQLSTATES.has(code)) return true;
  }
  return DRIVER_MESSAGES.some((pattern) => pattern.test(error.message));
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

const TRANSIENT_SQLSTATES = new Set([
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

const DRIVER_MESSAGES = [
  /^Connection terminated/,
  /^timeout exceeded when trying to connect$/,
  /^Client has encountered a connection error and is not queryable$/,
  /^Cannot use a pool after calling end on the pool$/,
];
