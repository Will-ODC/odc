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

/**
 * The poll ID in what someone typed for "Related question": either the ID
 * itself or a question link (`/?poll=<id>`), which is what people can copy.
 * Blank stays blank, so the field stays optional.
 */
export function pollReference(value: string): string {
  const typed = value.trim();
  if (!typed.includes("poll=")) return typed;
  try {
    return (
      new URL(typed, "https://pulse.invalid").searchParams
        .get("poll")
        ?.trim() || typed
    );
  } catch {
    return typed;
  }
}
