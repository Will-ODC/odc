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
  communityBenefit: string;
  needs: string;
  kind: ContributionKind;
  organizerName: string;
  pollId?: string;
  commercial?: CommercialOffer | null;
  fund?: { name: string; percentage: number } | null;
}
export interface ContributionSummary extends Omit<
  ContributionInput,
  "pollId" | "commercial" | "fund"
> {
  id: string;
  community: { id: string; label: string };
  pollId: string | null;
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
export interface ContributionsApi {
  list(cursor?: string): Promise<ContributionPage>;
  detail(id: string): Promise<ContributionDetail>;
  create(input: ContributionInput, key: string): Promise<Contribution>;
  participate(
    id: string,
    input: ParticipationInput,
    key: string,
  ): Promise<Contribution>;
  update(id: string, input: UpdateInput, key: string): Promise<Contribution>;
}

const kinds = ["project", "fundraiser", "group_buy", "offer"];
const statuses = ["open", "in_progress", "completed", "cancelled"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const text = (value: unknown): value is string => typeof value === "string";
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
export class ContributionsError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.doFetch(`/api/contributions${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        ...(body === undefined
          ? {}
          : {
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": key ?? "",
              },
              body: JSON.stringify(body),
            }),
      });
    } catch {
      throw new ContributionsError(0, "Connection lost. Please try again.");
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "Check the details and try again.",
        401: "Sign in to continue. Your entries are still here.",
        403: "You do not have permission to make this change.",
        404:
          path === "" && body !== undefined
            ? "Check the related poll ID or leave that field blank."
            : "This contribution could not be found.",
        409: "This contribution has changed. Reload it before trying again.",
        429: "Please wait a moment before trying again.",
      };
      throw new ContributionsError(
        response.status,
        messages[response.status] ??
          "Could not save this change. Please try again.",
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
  async list(cursor?: string): Promise<ContributionPage> {
    const data = await this.request(
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : "",
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
  create(input: ContributionInput, key: string) {
    return this.save("", input, key);
  }
  participate(id: string, input: ParticipationInput, key: string) {
    return this.save(
      `/${encodeURIComponent(id)}/participations`,
      input,
      key,
      id,
    );
  }
  update(id: string, input: UpdateInput, key: string) {
    return this.save(`/${encodeURIComponent(id)}/updates`, input, key, id);
  }
}
export const contributionsApi = new HttpContributionsApi();
