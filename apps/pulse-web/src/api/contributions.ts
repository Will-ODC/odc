import type { PictureInput, PublicImage } from "./types.js";

export type ContributionKind = "project" | "fundraiser" | "group_buy" | "offer";
export type ContributionStatus =
  "open" | "in_progress" | "completed" | "cancelled";
export type ParticipationKind = "help" | "pledge" | "report";
export interface CommercialOffer {
  currency: string;
  regularPriceMinor: number;
  offeredPriceMinor: number;
  referenceUrl: string;
  terms: string;
}
export interface ContributionInput {
  title: string;
  description: string;
  communityBenefit?: string;
  needs?: string;
  kind: ContributionKind;
  organizerName: string;
  pollId?: string;
  image?: PictureInput;
  commercial?: CommercialOffer | null;
  fund?: { name: string; percentage: number } | null;
}
export interface ContributionSummary extends Omit<
  ContributionInput,
  "pollId" | "commercial" | "fund" | "communityBenefit" | "needs" | "image"
> {
  id: string;
  communityBenefit: string;
  needs: string;
  community: { id: string; label: string };
  pollId: string | null;
  image: PublicImage;
  commercial: CommercialOffer | null;
  fund: { name: string; percentage: number } | null;
  status: ContributionStatus;
  createdAt: string;
}
export interface ParticipationInput {
  displayName: string;
  kind: ParticipationKind;
  message: string;
}
export interface UpdateInput {
  message: string;
  status: ContributionStatus;
  evidenceUrl?: string;
}
export interface Contribution extends ContributionSummary {
  organizerProfile?: { publicId: string; displayName: string };
  participations: (ParticipationInput & { id: string; createdAt: string })[];
  updates: (Omit<UpdateInput, "evidenceUrl"> & {
    id: string;
    createdAt: string;
    evidenceUrl: string | null;
  })[];
}
export interface ContributionDetail {
  contribution: Contribution;
  canManage: boolean;
}
export interface ContributionPage {
  contributions: ContributionSummary[];
  nextCursor: string | null;
}
export interface OrganizerMessage {
  id: string;
  message: string;
  createdAt: string;
}
export type ContributionPictureChange =
  PictureInput | { expectedImageId: string };

export interface ContributionsApi {
  sendMessage(
    id: string,
    message: string,
    key: string,
    accountId: string,
  ): Promise<void>;
  messages(id: string): Promise<OrganizerMessage[]>;
  list(cursor?: string): Promise<ContributionPage>;
  forProfile(publicId: string, cursor?: string): Promise<ContributionPage>;
  /**
   * The signed-in account's own contributions. `ownerAccountId` (the id from
   * `/api/me`) makes a missed account switch a 409 `account_changed`.
   */
  mine(cursor?: string, ownerAccountId?: string): Promise<ContributionPage>;
  detail(id: string): Promise<ContributionDetail>;
  changePicture(
    id: string,
    change: ContributionPictureChange,
  ): Promise<PublicImage>;
  create(
    input: ContributionInput,
    key: string,
    accountId: string,
  ): Promise<Contribution>;
  participate(
    id: string,
    input: ParticipationInput,
    key: string,
    accountId: string,
  ): Promise<Contribution>;
  update(
    id: string,
    input: UpdateInput,
    key: string,
    accountId: string,
  ): Promise<Contribution>;
}

const kinds = ["project", "fundraiser", "group_buy", "offer"];
const statuses = ["open", "in_progress", "completed", "cancelled"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const text = (value: unknown): value is string => typeof value === "string";
function publicImage(value: unknown): value is PublicImage {
  if (!isRecord(value)) return false;
  if (value.kind === "tile") return true;
  return (
    (value.kind === "upload" || value.kind === "category") &&
    text(value.displayUrl) &&
    text(value.thumbUrl) &&
    text(value.alt) &&
    typeof value.width === "number" &&
    value.width > 0 &&
    typeof value.height === "number" &&
    value.height > 0
  );
}
function summary(value: unknown): value is ContributionSummary {
  if (!isRecord(value)) return false;
  return (
    [
      "id",
      "title",
      "description",
      "communityBenefit",
      "needs",
      "organizerName",
      "createdAt",
    ].every((key) => text(value[key])) &&
    text(value.kind) &&
    kinds.includes(value.kind) &&
    text(value.status) &&
    statuses.includes(value.status) &&
    isRecord(value.community) &&
    text(value.community.id) &&
    text(value.community.label) &&
    publicImage(value.image) &&
    (value.pollId === null || text(value.pollId)) &&
    (value.commercial === null ||
      (isRecord(value.commercial) &&
        text(value.commercial.currency) &&
        ["CAD", "USD", "GBP", "EUR"].includes(value.commercial.currency) &&
        typeof value.commercial.regularPriceMinor === "number" &&
        value.commercial.regularPriceMinor > 0 &&
        typeof value.commercial.offeredPriceMinor === "number" &&
        value.commercial.offeredPriceMinor >= 0 &&
        Number.isSafeInteger(value.commercial.regularPriceMinor) &&
        Number.isSafeInteger(value.commercial.offeredPriceMinor) &&
        text(value.commercial.referenceUrl) &&
        text(value.commercial.terms))) &&
    (value.fund === null ||
      (isRecord(value.fund) &&
        text(value.fund.name) &&
        typeof value.fund.percentage === "number"))
  );
}
function contribution(value: unknown): value is Contribution {
  return (
    summary(value) &&
    isRecord(value) &&
    (value.organizerProfile === undefined ||
      (isRecord(value.organizerProfile) &&
        text(value.organizerProfile.publicId) &&
        text(value.organizerProfile.displayName))) &&
    Array.isArray(value.participations) &&
    value.participations.every(
      (item) =>
        isRecord(item) &&
        text(item.id) &&
        text(item.displayName) &&
        text(item.message) &&
        text(item.createdAt) &&
        ["help", "pledge", "report"].includes(String(item.kind)),
    ) &&
    Array.isArray(value.updates) &&
    value.updates.every(
      (item) =>
        isRecord(item) &&
        text(item.id) &&
        text(item.message) &&
        text(item.createdAt) &&
        statuses.includes(String(item.status)) &&
        (item.evidenceUrl === null || text(item.evidenceUrl)),
    )
  );
}
/**
 * What an `account_changed` refusal tells the person: the account the page
 * wrote for is not the one signed in now. Name what was not sent where the
 * page knows it ("your update"); the API error itself can only say "this".
 */
export function accountChangedMessage(what = "this"): string {
  return `Your account changed, so ${what} wasn't sent.`;
}
export const pictureChangedMessage =
  "The posted picture changed. Review it before removing.";
/** 409 codes that are not "someone else changed this": each says what to do. */
const conflicts: Record<string, string> = {
  account_changed: accountChangedMessage(),
  image_changed: pictureChangedMessage,
  sender_limit:
    "You have added as many entries to this contribution as one person can.",
  record_full: "This contribution has reached its entry limit.",
  closed: "This contribution is closed to new offers of help and pledges.",
};
export class ContributionsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export class HttpContributionsApi implements ContributionsApi {
  constructor(
    private readonly doFetch: typeof fetch = (...args) =>
      globalThis.fetch(...args),
  ) {}
  private async request(
    path: string,
    body?: unknown,
    key?: string,
    base = "/api/contributions",
    method: "GET" | "POST" | "PUT" | "DELETE" = body === undefined
      ? "GET"
      : "POST",
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        ...(body === undefined
          ? {}
          : {
              headers: {
                "Content-Type": "application/json",
                ...(key === undefined ? {} : { "Idempotency-Key": key }),
              },
              body: JSON.stringify(body),
            }),
      });
    } catch {
      throw new ContributionsError(0, "Connection lost. Please try again.");
    }
    if (!response.ok) {
      const refusal: unknown = await response.json().catch(() => null);
      const code =
        isRecord(refusal) && text(refusal.error) ? refusal.error : "";
      const pictureMessage =
        (method === "PUT" || method === "DELETE") &&
        (response.status === 400 || response.status === 401) &&
        isRecord(refusal) &&
        text(refusal.message)
          ? refusal.message
          : undefined;
      const messages: Record<number, string> = {
        400: "Check the details and try again.",
        401: "Sign in to continue. Your entries are still here.",
        403: "You do not have permission to make this change.",
        404:
          path === "" && body !== undefined
            ? "Check the related question or leave that field blank."
            : "This contribution could not be found.",
        409:
          conflicts[code] ??
          "This contribution has changed. Reload it before trying again.",
        429: "Please wait a moment before trying again.",
      };
      throw new ContributionsError(
        response.status,
        (code === "image_unavailable"
          ? "This picture is no longer available. Choose it again."
          : pictureMessage) ??
          messages[response.status] ??
          (method === "GET"
            ? "Could not load this. Try again."
            : "Could not save this change. Please try again."),
        code,
      );
    }
    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data))
      throw new ContributionsError(
        0,
        "The response could not be read. Please try again.",
      );
    return data;
  }
  async sendMessage(
    id: string,
    message: string,
    key: string,
    accountId: string,
  ): Promise<void> {
    const data = await this.request(
      `/${encodeURIComponent(id)}/messages`,
      { message, accountId },
      key,
    );
    if (!text(data.id) || typeof data.replayed !== "boolean")
      throw new ContributionsError(0, "Could not confirm delivery. Try again.");
  }
  async messages(id: string): Promise<OrganizerMessage[]> {
    const data = await this.request(`/${encodeURIComponent(id)}/messages`);
    if (
      !Array.isArray(data.messages) ||
      !data.messages.every(
        (entry): entry is OrganizerMessage =>
          isRecord(entry) &&
          text(entry.id) &&
          text(entry.message) &&
          text(entry.createdAt),
      )
    )
      throw new ContributionsError(0, "Could not load messages. Try again.");
    return data.messages;
  }
  async list(cursor?: string): Promise<ContributionPage> {
    return this.listAt("/api/contributions", cursor);
  }
  forProfile(publicId: string, cursor?: string): Promise<ContributionPage> {
    return this.listAt(
      `/api/profiles/${encodeURIComponent(publicId)}/contributions`,
      cursor,
    );
  }
  mine(cursor?: string, ownerAccountId?: string): Promise<ContributionPage> {
    return this.listAt("/api/me/contributions", cursor, ownerAccountId);
  }
  private async listAt(
    base: string,
    cursor?: string,
    ownerAccountId?: string,
  ): Promise<ContributionPage> {
    const query = [
      ...(cursor ? [`cursor=${encodeURIComponent(cursor)}`] : []),
      ...(ownerAccountId !== undefined
        ? [`ownerAccountId=${encodeURIComponent(ownerAccountId)}`]
        : []),
    ].join("&");
    const data = await this.request(
      query ? `?${query}` : "",
      undefined,
      undefined,
      base,
    );
    if (
      !Array.isArray(data.contributions) ||
      !data.contributions.every(summary) ||
      !(data.nextCursor === null || text(data.nextCursor))
    )
      throw new ContributionsError(
        0,
        "The contributions could not be read. Please try again.",
      );
    return { contributions: data.contributions, nextCursor: data.nextCursor };
  }
  async detail(id: string): Promise<ContributionDetail> {
    const data = await this.request(`/${encodeURIComponent(id)}`);
    if (!contribution(data.contribution) || typeof data.canManage !== "boolean")
      throw new ContributionsError(
        0,
        "This contribution could not be read. Please try again.",
      );
    return { contribution: data.contribution, canManage: data.canManage };
  }
  async changePicture(id: string, change: ContributionPictureChange) {
    const path = `/${encodeURIComponent(id)}/image`;
    const data =
      "expectedImageId" in change
        ? await this.request(
            `${path}?${new URLSearchParams(change)}`,
            undefined,
            undefined,
            undefined,
            "DELETE",
          )
        : await this.request(path, change, undefined, undefined, "PUT");
    if (!publicImage(data.image))
      throw new ContributionsError(
        0,
        "Could not confirm the picture change. Reload and try again.",
      );
    return data.image;
  }
  private async save(
    path: string,
    input: unknown,
    key: string,
    existingId?: string,
  ): Promise<Contribution> {
    const data = await this.request(path, input, key);
    if (!contribution(data.contribution) || typeof data.replayed !== "boolean")
      throw new ContributionsError(
        0,
        "The saved contribution could not be read. Retry to check it.",
      );
    // The original result proves the write succeeded. A replay may predate
    // later organizer updates or contributions, so refresh the current record.
    if (data.replayed && existingId)
      return (await this.detail(existingId)).contribution;
    return data.contribution;
  }
  create(input: ContributionInput, key: string, accountId: string) {
    return this.save("", { ...input, accountId }, key);
  }
  participate(
    id: string,
    input: ParticipationInput,
    key: string,
    accountId: string,
  ) {
    return this.save(
      `/${encodeURIComponent(id)}/participations`,
      { ...input, accountId },
      key,
      id,
    );
  }
  update(id: string, input: UpdateInput, key: string, accountId: string) {
    return this.save(
      `/${encodeURIComponent(id)}/updates`,
      { ...input, accountId },
      key,
      id,
    );
  }
}
export const contributionsApi = new HttpContributionsApi();
