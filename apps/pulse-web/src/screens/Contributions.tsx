import { useCallback, useState } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionsApi,
  type ContributionSummary,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { useContributionRead } from "../hooks/use-contributions.js";
import {
  contributionKinds,
  contributionStatuses,
  money,
  savings,
} from "../flow/contributions.js";
import "./Contributions.css";

export function Contributions({
  api,
  client = contributionsApi,
}: {
  api: PulseApi;
  client?: ContributionsApi;
}) {
  const load = useCallback(() => client.list(), [client]);
  const { data, reload, setData } = useContributionRead(load);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  async function more() {
    if (data.status !== "ready" || !data.value.nextCursor || loadingMore)
      return;
    setLoadingMore(true);
    setPageError("");
    try {
      const page = await client.list(data.value.nextCursor);
      const ids = new Set(data.value.contributions.map((item) => item.id));
      setData({
        status: "ready",
        value: {
          contributions: [
            ...data.value.contributions,
            ...page.contributions.filter((item) => !ids.has(item.id)),
          ],
          nextCursor: page.nextCursor,
        },
      });
    } catch {
      setPageError("Could not load more contributions. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <AppShell banner={<PageBanner api={api} currentHref="/contributions" />}>
      <section className="contributions-page">
        <header className="contributions-heading">
          <div>
            <h1>Contributions</h1>
            <p>
              Put your skills, time and resources to work for your community.
            </p>
          </div>
          <a className="contribution-button" href="/contributions/new">
            Start a contribution
          </a>
        </header>
        <ViewState data={data}>
          {(page) => (
            <>
              {page.contributions.length ? (
                <ul className="contributions-list">
                  {page.contributions.map((item) => (
                    <ContributionRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <div className="contributions-empty">
                  <h2>What could we do together?</h2>
                  <p>
                    Start a community project, ask for help, or share an offer
                    with meaningful savings.
                  </p>
                  <a href="/contributions/new">Post the first contribution</a>
                </div>
              )}
              {page.nextCursor ? (
                <button
                  type="button"
                  className="contribution-button contribution-button--secondary"
                  onClick={() => void more()}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </ViewState>
        {data.status === "error" ? (
          <button
            className="contribution-button contribution-button--secondary"
            onClick={reload}
          >
            Try again
          </button>
        ) : null}
        {pageError ? <p role="alert">{pageError}</p> : null}
      </section>
    </AppShell>
  );
}
function ContributionRow({ item }: { item: ContributionSummary }) {
  return (
    <li className="contribution-row">
      <div className="contribution-meta">
        <span>{contributionKinds[item.kind]}</span>
        <span>{contributionStatuses[item.status]}</span>
      </div>
      <h2>
        <a href={`/contributions/${encodeURIComponent(item.id)}`}>
          {item.title}
        </a>
      </h2>
      <p>{item.communityBenefit}</p>
      {item.commercial ? (
        <p className="contribution-price">
          {money(item.commercial.offeredPriceMinor, item.commercial.currency)}{" "}
          <span>{savings(item.commercial)}% advertised savings</span>
        </p>
      ) : null}
      <div className="contribution-meta">
        <span>By {item.organizerName}</span>
        <span>{item.community.label}</span>
      </div>
    </li>
  );
}
