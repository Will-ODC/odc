import { useCallback, useEffect, useState } from "react";
import type { Poll, PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { isSwipeable } from "../flow/swipe.js";
import { usePoll } from "../hooks/use-poll.js";
import { edgesOf, useNextQuestions } from "../hooks/use-next-questions.js";
import { AppShell } from "../components/AppShell.js";
import { NextUp, type NextItem } from "../components/NextUp.js";
import { SideNav, type RunStep } from "../components/SideNav.js";
import { TopBanner } from "../components/TopBanner.js";
import { ViewState } from "../components/ViewState.js";
import { SwipeBallot } from "./SwipeBallot.js";
import { ChoiceBallot } from "./ChoiceBallot.js";

/**
 * Walks the run.
 *
 * pulse still opens on a vote rather than a sign-in form — signing in is a
 * place you can go, never a gate you pass through — and answering is also
 * navigating: each choice names the poll it opens, so the run is a path
 * through a graph rather than a fixed list of screens. This component holds
 * where we are and picks the screen the current question needs; the screens
 * do the asking.
 *
 * Where we are is the end of a trail rather than a single id, because a
 * question does not know what came before it: two different answers can open
 * the same poll, so "the previous question" is a property of the walk and not
 * of the graph. Keeping the path taken is the only way back.
 */
export function Run({ api, pollId }: { api: PulseApi; pollId: string }) {
  const [trail, setTrail] = useState<string[]>([pollId]);
  const at = trail[trail.length - 1] ?? pollId;
  const loaded = usePoll(api, at);
  const poll = loaded.status === "ready" ? loaded.value : undefined;

  /**
   * The wording of every question this run has been through.
   *
   * The trail is ids, because that is all the walk knows; the left rail wants
   * words. They are kept as each question loads rather than fetched for the
   * rail, so going back costs no request and a rail that is one question
   * behind is impossible — the text arrives with the question it belongs to.
   */
  const [asked, setAsked] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!poll) return;
    const { id, question } = poll;
    setAsked((seen) =>
      seen[id] === question ? seen : { ...seen, [id]: question },
    );
  }, [poll]);

  /*
   * The rail's own copy of the previews the ballot shows under each answer.
   *
   * Both ballots already call this hook, so the same polls are asked for
   * twice. Tolerated rather than solved: the alternative is lifting the
   * preview out of two merged, tested screens and passing it back down, which
   * is the extraction this rail is not big enough to justify. The requests are
   * GETs of a poll that is already cached by the time they land.
   */
  const nextQuestions = useNextQuestions(api, poll ? edgesOf(poll.next) : "");

  const answered = useCallback((next: string | null) => {
    // A choice with nothing after it ends the run. Staying put is the honest
    // thing until there is a screen to end on.
    if (next) setTrail((walked) => [...walked, next]);
  }, []);

  /**
   * Back is a step off the end of the trail, not a re-walk of the graph.
   *
   * The question it returns to is asked again from the top rather than shown
   * with the earlier answer on it: an answer can be changed until the question
   * closes, so the ballot is still the truthful screen, and the server says
   * plainly that a second vote replaced the first.
   */
  const back = useCallback(() => {
    setTrail((walked) => (walked.length > 1 ? walked.slice(0, -1) : walked));
  }, []);

  /**
   * Back, but by however many steps the rail was asked for.
   *
   * The same move as `back` and not a second idea of it: both cut the trail,
   * because a run is the path walked and returning to an earlier question is
   * forgetting what came after it. Asking for the question already showing
   * does nothing, so the rail can pass any index without checking.
   */
  const goTo = useCallback((index: number) => {
    setTrail((walked) =>
      index >= 0 && index < walked.length - 1
        ? walked.slice(0, index + 1)
        : walked,
    );
  }, []);

  const steps: RunStep[] = trail.map((id) => {
    const question = asked[id];
    // `exactOptionalPropertyTypes`: omit the key, never pass undefined.
    return question === undefined ? { id } : { id, question };
  });

  /*
   * One row per answer that opens something. An answer that ends the run has
   * no row, which is what makes an empty rail mean "this is the last
   * question" rather than "the previews have not loaded".
   */
  const opens: NextItem[] = poll
    ? poll.choices.flatMap((answer, index) => {
        if (poll.next[index] == null) return [];
        const question = nextQuestions[index];
        return [question === undefined ? { answer } : { answer, question }];
      })
    : [];

  return (
    <AppShell
      banner={<TopBanner signInHref={pathOf({ kind: "signIn" })} />}
      nav={<SideNav steps={steps} current={trail.length - 1} onGoTo={goTo} />}
      aside={<NextUp items={opens} />}
    >
      <ViewState data={loaded}>
        {(current) => (
          <Ballot
            api={api}
            poll={current}
            onAnswered={answered}
            // Nothing to go back to on the question the run opened on, and a
            // control that would do nothing should not be on the screen.
            {...(trail.length > 1 ? { onBack: back } : {})}
          />
        )}
      </ViewState>
    </AppShell>
  );
}

/**
 * Which ballot a question needs is a property of the question: two choices are
 * a swipe, more than two are a list. Keyed by poll id so moving to the next
 * question starts a fresh screen rather than showing the last one's answer.
 */
function Ballot({
  api,
  poll,
  onAnswered,
  onBack,
}: {
  api: PulseApi;
  poll: Poll;
  onAnswered: (next: string | null) => void;
  onBack?: (() => void) | undefined;
}) {
  const shared = { api, poll, onAnswered, ...(onBack ? { onBack } : {}) };
  return isSwipeable(poll) ? (
    <SwipeBallot key={poll.id} {...shared} />
  ) : (
    <ChoiceBallot key={poll.id} {...shared} />
  );
}
