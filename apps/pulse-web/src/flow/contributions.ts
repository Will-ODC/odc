import type {
  ContributionKind,
  ContributionStatus,
  CommercialOffer,
} from "../api/contributions.js";
export const contributionKinds: Record<ContributionKind, string> = {
  project: "Community project",
  fundraiser: "Fundraiser",
  group_buy: "Group buy",
  offer: "Community offer",
};
export const contributionStatuses: Record<ContributionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completion reported",
  cancelled: "Cancelled",
};
export function savings(offer: CommercialOffer): number {
  return Math.round(
    (1 - offer.offeredPriceMinor / offer.regularPriceMinor) * 100,
  );
}
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(minor / 100);
}
export function safeExternalLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The longest poll ID the server accepts for "Related question". */
const POLL_ID_MAX = 128;

/**
 * The poll ID in what someone typed for "Related question": either the ID
 * itself or a question link (`/?poll=<id>`), which is what people can copy.
 * Blank stays blank, so the field stays optional.
 *
 * `undefined` when the text is neither: a link without `poll=`, or anything
 * with spaces, slashes or colons in it, or longer than any ID. Sending that
 * would only earn a generic error from the server, away from the field.
 */
export function pollReference(value: string): string | undefined {
  const typed = value.trim();
  if (!typed) return "";
  let id = typed;
  if (typed.includes("poll=")) {
    try {
      id =
        new URL(typed, "https://pulse.invalid").searchParams
          .get("poll")
          ?.trim() ?? "";
    } catch {
      return undefined;
    }
  }
  return id && id.length <= POLL_ID_MAX && !/[\s/:?#&=]/.test(id)
    ? id
    : undefined;
}
