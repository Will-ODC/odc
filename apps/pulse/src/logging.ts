import { MailRejectedError, MailSendError } from "./identity/mailer.js";

/** Deliberately excludes messages, stacks, causes, row details and inputs. */
export interface Fault {
  type: string;
  code?: string;
  status?: number;
}

type FaultLogger = (fields: { fault: Fault }, message: string) => void;

/** Error metadata can be an accessor or proxy; failed reads carry no detail. */
function readFaultField<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** One allow-listed projection for every unexpected fault (#503). */
export function logFault(
  log: FaultLogger,
  error: unknown,
  message: string,
): void {
  // Error.name is mutable and can contain input. The prototype's constructor
  // names the error class instead, without the message, stack or cause.
  const isError = readFaultField(() => error instanceof Error) ?? false;
  const constructorName = readFaultField(() =>
    isError ? Object.getPrototypeOf(error)?.constructor?.name : undefined,
  );
  const type =
    typeof constructorName === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(constructorName)
      ? constructorName
      : isError
        ? "Error"
        : typeof error;
  const code = readFaultField(() => (error as { code?: unknown } | null)?.code);
  const status = readFaultField(() =>
    error instanceof MailSendError || error instanceof MailRejectedError
      ? error.status
      : undefined,
  );
  try {
    log(
      {
        fault: {
          type,
          ...(typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
            ? { code }
            : {}),
          ...(typeof status === "number" &&
          Number.isInteger(status) &&
          status >= 100 &&
          status <= 599
            ? { status }
            : {}),
        },
      },
      message,
    );
  } catch {
    // A broken sink must not make the HTTP handler fall back to logging and
    // returning a raw error. There is no safe secondary logger here.
  }
}

/** The same projection for entry-point warnings that use a line sink. */
export function textFaultLogger(log: (message: string) => void): FaultLogger {
  return ({ fault }, message) => log(`${message}: ${JSON.stringify(fault)}`);
}
