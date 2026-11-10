import { MailRejectedError, MailSendError } from "./identity/mailer.js";

/** Deliberately excludes messages, stacks, causes, row details and inputs. */
export interface Fault {
  type: string;
  code?: string;
  status?: number;
}

type FaultLogger = (fields: { fault: Fault }, message: string) => void;

/** One allow-listed projection for every unexpected fault (#503). */
export function logFault(
  log: FaultLogger,
  error: unknown,
  message: string,
): void {
  // Error.name is mutable and can contain input. The prototype's constructor
  // names the error class instead, without the message, stack or cause.
  const constructorName =
    error instanceof Error
      ? Object.getPrototypeOf(error)?.constructor?.name
      : undefined;
  const type =
    typeof constructorName === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(constructorName)
      ? constructorName
      : error instanceof Error
        ? "Error"
        : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const status =
    error instanceof MailSendError || error instanceof MailRejectedError
      ? error.status
      : undefined;
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
}

/** The same projection for entry-point warnings that use a line sink. */
export function textFaultLogger(log: (message: string) => void): FaultLogger {
  return ({ fault }, message) => log(`${message}: ${JSON.stringify(fault)}`);
}
