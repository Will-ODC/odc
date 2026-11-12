import type { ContributionSummary } from "../api/contributions.js";
import type { PollSummary } from "../api/types.js";
import { contributionKinds, contributionStatuses } from "./contributions.js";
import { pathOf } from "./route.js";

export interface BrowseItem {
  key: string;
  kind: "poll" | "contribution";
  title: string;
  href: string;
  status: string;
  createdAt: string;
  tag?: string;
}

export function browseItems(
  polls: PollSummary[],
  contributions: ContributionSummary[],
): BrowseItem[] {
  const items: BrowseItem[] = [
    ...polls.map((poll): BrowseItem => ({
      key: `poll:${poll.id}`,
      kind: "poll",
      title: poll.question,
      href: pathOf({ kind: "conversation", pollId: poll.id }),
      status: poll.open ? "Open" : "Closed · View results",
      createdAt: poll.createdAt,
    })),
    ...contributions.map((item): BrowseItem => ({
      key: `contribution:${item.id}`,
      kind: "contribution",
      title: item.title,
      href: pathOf({ kind: "contribution", id: item.id }),
      status: contributionStatuses[item.status],
      createdAt: item.createdAt,
      tag: `Contribution · ${contributionKinds[item.kind]}`,
    })),
  ];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
