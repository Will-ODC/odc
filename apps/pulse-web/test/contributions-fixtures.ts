import { vi } from "vitest";
import type {
  Contribution,
  ContributionsApi,
} from "../src/api/contributions.js";
import type { PulseApi } from "../src/api/types.js";

export const contributionFixture = (
  over: Partial<Contribution> = {},
): Contribution => ({
  id: "park",
  title: "Make the park accessible",
  description: "Build a ramp together.",
  communityBenefit: "Everyone can reach the garden.",
  needs: "Carpenters and materials",
  kind: "project",
  organizerName: "Test organizer",
  community: { id: "pulse-general", label: "General" },
  image: { kind: "tile" },
  pollId: null,
  commercial: null,
  fund: null,
  status: "open",
  createdAt: "2026-11-11T12:00:00.000Z",
  participations: [],
  updates: [],
  ...over,
});
export const stubContributionsApi = (
  over: Partial<ContributionsApi> = {},
): ContributionsApi => ({
  list: async () => ({
    contributions: [contributionFixture()],
    nextCursor: null,
  }),
  forProfile: async () => ({
    contributions: [contributionFixture()],
    nextCursor: null,
  }),
  mine: async () => ({
    contributions: [contributionFixture()],
    nextCursor: null,
  }),
  changePicture: async () => ({ kind: "tile" }),
  sendMessage: async () => {},
  messages: async () => [],
  detail: async () => ({
    contribution: contributionFixture(),
    canManage: false,
  }),
  create: async () => contributionFixture(),
  participate: async () => contributionFixture(),
  update: async () => contributionFixture(),
  ...over,
});

export const parkPictureId = "94cc4bb0-a508-411a-9f1d-afefa9c30b0c";
export const parkPicture = {
  kind: "upload",
  displayUrl: `/api/poll-images/${parkPictureId}/display.webp`,
  thumbUrl: `/api/poll-images/${parkPictureId}/thumb.webp`,
  width: 800,
  height: 600,
  alt: "A ramp leading into the park",
} as const;

/** A `me()` the test can switch between accounts, nobody, or offline. */
export function switchableMe(start: string | null) {
  const state: { who: string | null } = { who: start };
  const me = vi.fn<PulseApi["me"]>(async () => {
    if (state.who === "offline") throw new Error("Offline");
    return state.who === null
      ? null
      : { id: state.who, email: `${state.who}@example.test`, community: null };
  });
  return { state, me };
}
